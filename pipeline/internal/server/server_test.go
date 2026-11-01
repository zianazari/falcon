package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"falcon/pipeline/internal/detect"
	"falcon/pipeline/internal/event"
)

type memSink struct {
	events      []event.Event
	alerts      []event.Alert
	deadletters []event.DeadLetter
	failEvents  bool
	lastCanary  time.Time
	failLookup  bool
}

func (m *memSink) WriteEvent(_ context.Context, ev event.Event) error {
	if m.failEvents {
		return errors.New("bigquery unavailable")
	}
	m.events = append(m.events, ev)
	return nil
}
func (m *memSink) WriteAlerts(_ context.Context, a []event.Alert) error {
	m.alerts = append(m.alerts, a...)
	return nil
}
func (m *memSink) WriteDeadLetter(_ context.Context, dl event.DeadLetter) error {
	m.deadletters = append(m.deadletters, dl)
	return nil
}
func (m *memSink) LastEvent(_ context.Context, action, suffix string) (time.Time, error) {
	if m.failLookup {
		return time.Time{}, errors.New("bigquery unavailable")
	}
	if action != CanaryAction || suffix != CanaryResource {
		return time.Time{}, errors.New("unexpected canary lookup")
	}
	return m.lastCanary, nil
}
func (m *memSink) Close() error { return nil }

type countNotifier struct{ n int }

func (c *countNotifier) Notify(context.Context, event.Alert) error { c.n++; return nil }

const rule = `
id: sa-key
title: SA key created
description: test
severity: high
match: {field: action, equals: google.iam.admin.v1.CreateServiceAccountKey}
`

const entry = `{"insertId":"evt-1","logName":"projects/p/logs/cloudaudit.googleapis.com%2Factivity",
"timestamp":"2026-10-01T12:00:00Z","protoPayload":{"@type":"type.googleapis.com/google.cloud.audit.AuditLog",
"methodName":"google.iam.admin.v1.CreateServiceAccountKey","authenticationInfo":{"principalEmail":"m@corp.example"}}}`

func newTestServer(t *testing.T, s *memSink, n *countNotifier) *httptest.Server {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "r.yaml"), []byte(rule), 0o644); err != nil {
		t.Fatal(err)
	}
	rules, err := detect.LoadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := New(detect.NewEngine(rules), s, n, log, 100)
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts
}

func push(t *testing.T, url, msgID, data string) int {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"message":      map[string]any{"data": base64.StdEncoding.EncodeToString([]byte(data)), "messageId": msgID},
		"subscription": "projects/p/subscriptions/s",
	})
	resp, err := http.Post(url+"/pubsub/push", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

func TestPushProducesAlertAndDedups(t *testing.T) {
	s, n := &memSink{}, &countNotifier{}
	ts := newTestServer(t, s, n)

	if code := push(t, ts.URL, "m1", entry); code != http.StatusNoContent {
		t.Fatalf("status = %d", code)
	}
	// Pub/Sub redelivery of the same log entry.
	if code := push(t, ts.URL, "m2", entry); code != http.StatusNoContent {
		t.Fatalf("status = %d", code)
	}
	if len(s.events) != 1 || len(s.alerts) != 1 || n.n != 1 {
		t.Fatalf("events=%d alerts=%d notified=%d, want 1/1/1", len(s.events), len(s.alerts), n.n)
	}
	if s.alerts[0].RuleID != "sa-key" || s.alerts[0].Actor != "m@corp.example" {
		t.Errorf("alert = %+v", s.alerts[0])
	}
}

func TestPoisonMessageIsDeadLetteredAndAcked(t *testing.T) {
	s := &memSink{}
	ts := newTestServer(t, s, &countNotifier{})
	if code := push(t, ts.URL, "bad-1", "not json {"); code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 so Pub/Sub does not retry", code)
	}
	if len(s.deadletters) != 1 || s.deadletters[0].MessageID != "bad-1" {
		t.Fatalf("deadletters = %+v", s.deadletters)
	}
}

func TestSinkFailureIsRetried(t *testing.T) {
	s := &memSink{failEvents: true}
	ts := newTestServer(t, s, &countNotifier{})
	if code := push(t, ts.URL, "m1", entry); code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 so Pub/Sub retries", code)
	}
	// The failed event must not be remembered as seen, or the retry would be dropped.
	s.failEvents = false
	push(t, ts.URL, "m1", entry)
	if len(s.events) != 1 {
		t.Fatalf("retry was not processed: events=%d", len(s.events))
	}
}

func TestDedupEvictsOldest(t *testing.T) {
	d := newDedup(2)
	d.add("a")
	d.add("b")
	d.add("c")
	if d.seen("a") || !d.seen("b") || !d.seen("c") {
		t.Fatal("ring eviction wrong")
	}
}

func checkCanary(t *testing.T, ts *httptest.Server) (int, bool) {
	t.Helper()
	res, err := http.Post(ts.URL+"/canary/check", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body struct {
		Healthy bool `json:"healthy"`
	}
	json.NewDecoder(res.Body).Decode(&body)
	return res.StatusCode, body.Healthy
}

func TestCanaryRecentIsHealthy(t *testing.T) {
	s := &memSink{lastCanary: time.Now().Add(-5 * time.Minute)}
	n := &countNotifier{}
	code, healthy := checkCanary(t, newTestServer(t, s, n))
	if code != 200 || !healthy || len(s.alerts) != 0 || n.n != 0 {
		t.Fatalf("code=%d healthy=%v alerts=%d notified=%d", code, healthy, len(s.alerts), n.n)
	}
}

func TestCanaryStaleAlertsOncePerOutage(t *testing.T) {
	s := &memSink{lastCanary: time.Now().Add(-time.Hour)}
	n := &countNotifier{}
	ts := newTestServer(t, s, n)
	for range 3 {
		if code, healthy := checkCanary(t, ts); code != 200 || healthy {
			t.Fatalf("code=%d healthy=%v", code, healthy)
		}
	}
	if len(s.alerts) != 1 || n.n != 1 {
		t.Fatalf("alerts=%d notified=%d, want one of each", len(s.alerts), n.n)
	}
	if s.alerts[0].RuleID != canaryRule || s.alerts[0].Severity != "high" {
		t.Fatalf("alert = %+v", s.alerts[0])
	}
	// A new outage, after a canary got through, alerts again.
	s.lastCanary = time.Now().Add(-30 * time.Minute)
	checkCanary(t, ts)
	if len(s.alerts) != 2 {
		t.Fatalf("alerts=%d, want a second alert for the new outage", len(s.alerts))
	}
}

func TestCanaryNeverSeenAlerts(t *testing.T) {
	s := &memSink{}
	if _, healthy := checkCanary(t, newTestServer(t, s, &countNotifier{})); healthy || len(s.alerts) != 1 {
		t.Fatalf("healthy=%v alerts=%d", healthy, len(s.alerts))
	}
}

func TestCanaryLookupFailureIs500(t *testing.T) {
	s := &memSink{failLookup: true}
	if code, _ := checkCanary(t, newTestServer(t, s, &countNotifier{})); code != 500 || len(s.alerts) != 0 {
		t.Fatalf("code=%d alerts=%d", code, len(s.alerts))
	}
}
