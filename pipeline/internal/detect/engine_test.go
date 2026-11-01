package detect

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"falcon/pipeline/internal/event"
)

func writeRule(t *testing.T, dir, name, body string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

const ownerRule = `
id: owner-granted
title: Owner granted
description: test
severity: high
mitre: [T1098.003]
match:
  all:
    - field: action
      ends_with: SetIamPolicy
    - field: outcome
      equals: success
    - some: iam_deltas
      where:
        all:
          - field: action
            equals: ADD
          - field: role
            in: [roles/owner, roles/editor]
`

func TestEngineMatchesCorrelatedListElement(t *testing.T) {
	dir := t.TempDir()
	writeRule(t, dir, "owner.yaml", ownerRule)
	rules, err := LoadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	eng := NewEngine(rules)

	base := event.Event{ID: "e1", Action: "SetIamPolicy", Outcome: "success"}

	fire := base
	fire.IAMDeltas = []event.IAMDelta{{Action: "ADD", Role: "roles/owner", Member: "user:x"}}

	// ADD and roles/owner both appear, but in different deltas: must not fire.
	split := base
	split.IAMDeltas = []event.IAMDelta{
		{Action: "REMOVE", Role: "roles/owner", Member: "user:x"},
		{Action: "ADD", Role: "roles/viewer", Member: "user:y"},
	}

	failed := fire
	failed.Outcome = "failure"

	cases := []struct {
		name string
		ev   event.Event
		want int
	}{
		{"owner added", fire, 1},
		{"conditions split across deltas", split, 0},
		{"failed call", failed, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			alerts, err := eng.Evaluate(c.ev, time.Now())
			if err != nil {
				t.Fatal(err)
			}
			if len(alerts) != c.want {
				t.Fatalf("got %d alerts, want %d", len(alerts), c.want)
			}
			if c.want == 1 && alerts[0].ID != "owner-granted:e1" {
				t.Errorf("alert id = %s", alerts[0].ID)
			}
		})
	}
}

func TestOperators(t *testing.T) {
	doc := map[string]any{
		"action":      "v1.compute.firewalls.insert",
		"status_code": float64(7),
		"raw":         map[string]any{"request": map[string]any{"sourceRanges": []any{"10.0.0.0/8", "0.0.0.0/0"}}},
	}
	yes, no := true, false
	s := func(v string) *string { return &v }
	cases := []struct {
		name string
		node Node
		want bool
	}{
		{"equals", Node{Field: "action", Equals: "v1.compute.firewalls.insert"}, true},
		{"equals number", Node{Field: "status_code", Equals: 7}, true},
		{"in", Node{Field: "action", In: []any{"a", "v1.compute.firewalls.insert"}}, true},
		{"contains", Node{Field: "action", Contains: s("firewalls")}, true},
		{"starts_with", Node{Field: "action", StartsWith: s("v1.compute")}, true},
		{"ends_with miss", Node{Field: "action", EndsWith: s("delete")}, false},
		{"list any element", Node{Field: "raw.request.sourceRanges", Equals: "0.0.0.0/0"}, true},
		{"exists", Node{Field: "raw.request", Exists: &yes}, true},
		{"not exists", Node{Field: "raw.missing", Exists: &no}, true},
		{"not", Node{Not: &Node{Field: "action", Equals: "x"}}, true},
		{"any", Node{Any: []*Node{{Field: "action", Equals: "x"}, {Field: "status_code", Equals: 7}}}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.node.eval(doc); got != c.want {
				t.Fatalf("eval = %v, want %v", got, c.want)
			}
		})
	}

	re := Node{Field: "action", Regex: s(`^v1\.compute\.firewalls\.(insert|patch)$`)}
	if err := re.validate("t"); err != nil {
		t.Fatal(err)
	}
	if !re.eval(doc) {
		t.Error("regex should match")
	}
}

func TestValidationErrors(t *testing.T) {
	cases := map[string]string{
		"unknown key": `
id: bad-rule
title: t
description: d
severity: high
match:
  field: action
  equal: x
`,
		"bad severity": `
id: bad-rule
title: t
description: d
severity: urgent
match: {field: action, equals: x}
`,
		"two operators": `
id: bad-rule
title: t
description: d
severity: low
match: {field: action, equals: x, contains: y}
`,
		"bad id": `
id: Bad_Rule
title: t
description: d
severity: low
match: {field: action, equals: x}
`,
		"some without where": `
id: bad-rule
title: t
description: d
severity: low
match: {some: iam_deltas}
`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			p := writeRule(t, t.TempDir(), "r.yaml", body)
			if _, err := LoadFile(p); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestDuplicateIDs(t *testing.T) {
	dir := t.TempDir()
	writeRule(t, dir, "a.yaml", ownerRule)
	writeRule(t, dir, "b.yaml", ownerRule)
	_, err := LoadDir(dir)
	if err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("err = %v, want duplicate id error", err)
	}
}
