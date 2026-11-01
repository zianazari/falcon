package detect

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	"falcon/pipeline/internal/event"
)

// Engine evaluates a fixed set of rules.
type Engine struct {
	rules []*Rule
}

// NewEngine keeps only enabled rules.
func NewEngine(rules []*Rule) *Engine {
	var enabled []*Rule
	for _, r := range rules {
		if r.IsEnabled() {
			enabled = append(enabled, r)
		}
	}
	return &Engine{rules: enabled}
}

// Rules returns the enabled rules.
func (e *Engine) Rules() []*Rule { return e.rules }

// Evaluate returns one alert per rule that matches ev.
func (e *Engine) Evaluate(ev event.Event, now time.Time) ([]event.Alert, error) {
	doc, err := toDoc(ev)
	if err != nil {
		return nil, err
	}
	var alerts []event.Alert
	for _, r := range e.rules {
		if r.Match.eval(doc) {
			alerts = append(alerts, newAlert(r, ev, now))
		}
	}
	return alerts, nil
}

// Matches reports whether a single rule matches ev (used by the fixture runner).
func Matches(r *Rule, ev event.Event) (bool, error) {
	doc, err := toDoc(ev)
	if err != nil {
		return false, err
	}
	return r.Match.eval(doc), nil
}

func newAlert(r *Rule, ev event.Event, now time.Time) event.Alert {
	return event.Alert{
		// Deterministic, so a redelivered message produces the same alert ID.
		ID:          r.ID + ":" + ev.ID,
		RuleID:      r.ID,
		Title:       r.Title,
		Severity:    r.Severity,
		Mitre:       r.Mitre,
		Runbook:     r.Runbook,
		EventID:     ev.ID,
		EventTime:   ev.Timestamp,
		DetectedAt:  now.UTC(),
		Actor:       ev.Actor,
		Action:      ev.Action,
		Resource:    ev.Resource,
		Project:     ev.Project,
		SrcIP:       ev.SrcIP,
		Description: strings.TrimSpace(r.Description),
	}
}

// toDoc converts the event to the generic map rules are written against, so
// rules can reach into raw.* as well as the normalized fields.
func toDoc(ev event.Event) (map[string]any, error) {
	b, err := json.Marshal(ev)
	if err != nil {
		return nil, err
	}
	var doc map[string]any
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, err
	}
	return doc, nil
}

func (n *Node) eval(doc any) bool {
	switch {
	case n.All != nil:
		for _, c := range n.All {
			if !c.eval(doc) {
				return false
			}
		}
		return true
	case n.Any != nil:
		return slices.ContainsFunc(n.Any, func(c *Node) bool { return c.eval(doc) })
	case n.Not != nil:
		return !n.Not.eval(doc)
	case n.Some != "":
		for _, item := range resolve(doc, n.Some) {
			if n.Where.eval(item) {
				return true
			}
		}
		return false
	}

	values := resolve(doc, n.Field)
	if n.Exists != nil {
		return (len(values) > 0) == *n.Exists
	}
	// A field that resolves to several values (a list) matches if any value does.
	return slices.ContainsFunc(values, n.matchValue)
}

func (n *Node) matchValue(v any) bool {
	s := scalar(v)
	switch {
	case n.Equals != nil:
		return s == scalar(n.Equals)
	case n.In != nil:
		return slices.ContainsFunc(n.In, func(want any) bool { return s == scalar(want) })
	case n.Contains != nil:
		return strings.Contains(s, *n.Contains)
	case n.StartsWith != nil:
		return strings.HasPrefix(s, *n.StartsWith)
	case n.EndsWith != nil:
		return strings.HasSuffix(s, *n.EndsWith)
	case n.Regex != nil:
		return n.re.MatchString(s)
	}
	return false
}

// resolve walks a dot path. Lists along the way are flattened, so
// "iam_deltas.role" yields every role. Missing and null values yield nothing.
func resolve(doc any, path string) []any {
	current := []any{doc}
	for _, key := range strings.Split(path, ".") {
		var next []any
		for _, c := range current {
			m, ok := c.(map[string]any)
			if !ok {
				continue
			}
			v, ok := m[key]
			if !ok || v == nil {
				continue
			}
			if list, isList := v.([]any); isList {
				next = append(next, list...)
			} else {
				next = append(next, v)
			}
		}
		current = next
	}
	return current
}

// scalar compares YAML values (int, bool) and JSON values (float64, bool)
// by their string form.
func scalar(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return fmt.Sprintf("%g", t)
	default:
		return fmt.Sprint(t)
	}
}
