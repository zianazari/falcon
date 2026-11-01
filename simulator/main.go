// Command simulator drives the local demo against the Pub/Sub emulator.
//
//	simulator setup    create the audit-log topic and a push subscription to the pipeline
//	simulator attack   publish an attack story plus benign noise and a poison message,
//	                   then check that the pipeline raised exactly the expected alerts
//
// It talks to the emulator's REST API, so it has no dependencies. Exit code 1
// means the end-to-end check failed, which makes `make e2e` usable in CI.
package main

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
)

type config struct {
	emulator, project, topic, subscription, pushEndpoint string
	pipeline, dataDir                                    string
	noise                                                int
	timeout                                              time.Duration
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: simulator setup|attack [flags]")
		os.Exit(2)
	}
	var cfg config
	fs := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	fs.StringVar(&cfg.emulator, "emulator", envOr("PUBSUB_EMULATOR_HOST", "localhost:8085"), "Pub/Sub emulator host:port")
	fs.StringVar(&cfg.project, "project", "falcon-local", "GCP project ID used in the emulator")
	fs.StringVar(&cfg.topic, "topic", "audit-logs", "topic the log sink publishes to")
	fs.StringVar(&cfg.subscription, "subscription", "pipeline-push", "push subscription name")
	fs.StringVar(&cfg.pushEndpoint, "push-endpoint", "http://pipeline:8080/pubsub/push", "pipeline URL as seen from the emulator")
	fs.StringVar(&cfg.pipeline, "pipeline", "http://localhost:8080", "pipeline URL as seen from here")
	fs.StringVar(&cfg.dataDir, "data", ".data", "pipeline file-sink directory")
	fs.IntVar(&cfg.noise, "noise", 40, "number of benign events")
	fs.DurationVar(&cfg.timeout, "timeout", 30*time.Second, "how long to wait for alerts")
	fs.Parse(os.Args[2:])

	var err error
	switch os.Args[1] {
	case "setup":
		err = setup(cfg)
	case "attack":
		err = attack(cfg)
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "FAIL:", err)
		os.Exit(1)
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func (c config) url(path string) string {
	return fmt.Sprintf("http://%s/v1/projects/%s/%s", c.emulator, c.project, path)
}

func call(method, url string, body any) ([]byte, int, error) {
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, r)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return out, resp.StatusCode, nil
}

func setup(c config) error {
	_, code, err := call(http.MethodPut, c.url("topics/"+c.topic), map[string]any{})
	if err != nil {
		return fmt.Errorf("emulator unreachable at %s: %w", c.emulator, err)
	}
	if code != http.StatusOK && code != http.StatusConflict {
		return fmt.Errorf("create topic: HTTP %d", code)
	}
	body, code, err := call(http.MethodPut, c.url("subscriptions/"+c.subscription), map[string]any{
		"topic":              fmt.Sprintf("projects/%s/topics/%s", c.project, c.topic),
		"pushConfig":         map[string]any{"pushEndpoint": c.pushEndpoint},
		"ackDeadlineSeconds": 30,
	})
	if err != nil {
		return err
	}
	if code != http.StatusOK && code != http.StatusConflict {
		return fmt.Errorf("create subscription: HTTP %d: %s", code, body)
	}
	fmt.Printf("ready: topic %s -> push subscription %s -> %s\n", c.topic, c.subscription, c.pushEndpoint)
	return nil
}

func publish(c config, payloads [][]byte) ([]string, error) {
	var msgs []map[string]string
	for _, p := range payloads {
		msgs = append(msgs, map[string]string{"data": base64.StdEncoding.EncodeToString(p)})
	}
	body, code, err := call(http.MethodPost, c.url("topics/"+c.topic+":publish"), map[string]any{"messages": msgs})
	if err != nil {
		return nil, err
	}
	if code != http.StatusOK {
		return nil, fmt.Errorf("publish: HTTP %d: %s (did you run `make up`?)", code, body)
	}
	var resp struct {
		MessageIDs []string `json:"messageIds"`
	}
	return resp.MessageIDs, json.Unmarshal(body, &resp)
}

func attack(c config) error {
	runID := fmt.Sprintf("%d", time.Now().UnixNano())
	g := newGen(runID, time.Now().UTC())

	steps := attackStory(g)
	var noise []map[string]any
	for i := 0; i < c.noise; i++ {
		noise = append(noise, g.benign(i))
	}

	fmt.Printf("== Falcon attack simulation (run %s) ==\n\n", runID)
	fmt.Println("Attack story (mallory@corp.example, phished session from 203.0.113.66):")
	var payloads [][]byte
	expected := map[string]string{} // rule id -> step
	for i, s := range steps {
		fmt.Printf("  %d. %-58s expect %s\n", i+1, s.desc, s.rule)
		expected[s.rule] = s.desc
		b, _ := json.Marshal(s.entry)
		payloads = append(payloads, b)
	}
	for _, n := range noise {
		b, _ := json.Marshal(n)
		payloads = append(payloads, b)
	}
	fmt.Printf("  + %d benign events (CI deploys, reads, harmless IAM changes, denied attempts)\n", len(noise))
	fmt.Println("  + 1 poison message (not a LogEntry)")

	ids, err := publish(c, payloads)
	if err != nil {
		return err
	}
	poisonIDs, err := publish(c, [][]byte{[]byte("this is not a log entry {")})
	if err != nil {
		return err
	}
	fmt.Printf("\npublished %d messages, waiting for the pipeline...\n\n", len(ids)+len(poisonIDs))

	prefix := "sim-" + runID + "-"
	var got map[string][]alertLine
	deadline := time.Now().Add(c.timeout)
	poisonSeen := false
	for {
		got = readAlerts(c.dataDir+"/alerts.jsonl", prefix)
		poisonSeen = containsMessageID(c.dataDir+"/deadletter.jsonl", poisonIDs[0])
		if (len(got) >= len(expected) && poisonSeen) || time.Now().After(deadline) {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	// Let any stragglers (benign events) land so false positives are caught too.
	time.Sleep(1500 * time.Millisecond)
	got = readAlerts(c.dataDir+"/alerts.jsonl", prefix)

	fmt.Println("Alerts raised:")
	var ruleIDs []string
	for id := range got {
		ruleIDs = append(ruleIDs, id)
	}
	sort.Strings(ruleIDs)
	for _, id := range ruleIDs {
		for _, a := range got[id] {
			fmt.Printf("  [%-8s] %-32s actor=%s  mitre=%s\n", strings.ToUpper(a.Severity), a.RuleID, a.Actor, strings.Join(a.Mitre, ","))
		}
	}

	var failures []string
	hits, falsePositives := 0, 0
	for rule, desc := range expected {
		if len(got[rule]) == 0 {
			failures = append(failures, fmt.Sprintf("missed detection %s (%s)", rule, desc))
		} else {
			hits++
		}
	}
	for rule, alerts := range got {
		for _, a := range alerts {
			if _, ok := expected[rule]; !ok || !strings.HasPrefix(a.EventID, prefix+"attack-") {
				falsePositives++
				failures = append(failures, fmt.Sprintf("false positive %s on event %s", rule, a.EventID))
			}
		}
	}
	if !poisonSeen {
		failures = append(failures, "poison message was not dead-lettered")
	}

	fmt.Println()
	if stats, err := fetchStats(c.pipeline); err == nil {
		fmt.Printf("Pipeline stats: %s\n", stats)
	}
	fmt.Printf("Detected %d/%d attack steps, %d false positives on %d benign events, poison message dead-lettered: %v\n",
		hits, len(expected), falsePositives, len(noise), poisonSeen)
	if len(failures) > 0 {
		sort.Strings(failures)
		return fmt.Errorf("end-to-end check failed:\n  %s", strings.Join(failures, "\n  "))
	}
	fmt.Println("PASS: end-to-end check succeeded")
	return nil
}

type alertLine struct {
	RuleID   string   `json:"rule_id"`
	Severity string   `json:"severity"`
	Actor    string   `json:"actor"`
	Mitre    []string `json:"mitre"`
	EventID  string   `json:"event_id"`
}

func readAlerts(path, prefix string) map[string][]alertLine {
	out := map[string][]alertLine{}
	f, err := os.Open(path)
	if err != nil {
		return out
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		var a alertLine
		if json.Unmarshal(sc.Bytes(), &a) == nil && strings.HasPrefix(a.EventID, prefix) {
			out[a.RuleID] = append(out[a.RuleID], a)
		}
	}
	return out
}

func containsMessageID(path, id string) bool {
	data, err := os.ReadFile(path)
	return err == nil && bytes.Contains(data, []byte(`"message_id":"`+id+`"`))
}

func fetchStats(base string) (string, error) {
	resp, err := http.Get(base + "/stats")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	return strings.TrimSpace(string(b)), err
}
