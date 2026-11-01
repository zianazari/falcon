// Package event defines the normalized security event and alert schemas that
// every stage of the pipeline (detection, sinks, notifiers) works with.
package event

import (
	"encoding/json"
	"time"
)

// Event is a single security-relevant log entry mapped to a source-agnostic
// schema. Detections match against the JSON form of this struct, so the json
// tags are part of the rule-authoring contract.
type Event struct {
	ID            string          `json:"id"`
	Timestamp     time.Time       `json:"ts"`
	ReceivedAt    time.Time       `json:"received_at"`
	Source        string          `json:"source"`
	LogType       string          `json:"log_type"`
	Service       string          `json:"service"`
	Action        string          `json:"action"`
	Resource      string          `json:"resource"`
	Project       string          `json:"project"`
	Actor         string          `json:"actor"`
	ActorType     string          `json:"actor_type"`
	SrcIP         string          `json:"src_ip"`
	IPClass       string          `json:"ip_class"`
	UserAgent     string          `json:"user_agent"`
	Outcome       string          `json:"outcome"`
	StatusCode    int             `json:"status_code"`
	StatusMessage string          `json:"status_message,omitempty"`
	Severity      string          `json:"severity"`
	IAMDeltas     []IAMDelta      `json:"iam_deltas,omitempty"`
	Raw           json.RawMessage `json:"raw"`
}

// IAMDelta is one binding change from an IAM policy update.
type IAMDelta struct {
	Action string `json:"action"`
	Role   string `json:"role"`
	Member string `json:"member"`
}

// Alert is produced when a detection rule matches an event.
type Alert struct {
	ID          string    `json:"id"`
	RuleID      string    `json:"rule_id"`
	Title       string    `json:"title"`
	Severity    string    `json:"severity"`
	Mitre       []string  `json:"mitre"`
	Runbook     string    `json:"runbook,omitempty"`
	EventID     string    `json:"event_id"`
	EventTime   time.Time `json:"event_ts"`
	DetectedAt  time.Time `json:"detected_at"`
	Actor       string    `json:"actor"`
	Action      string    `json:"action"`
	Resource    string    `json:"resource"`
	Project     string    `json:"project"`
	SrcIP       string    `json:"src_ip"`
	Description string    `json:"description"`
}

// DeadLetter records a message that could not be parsed, so it is acked
// (not retried forever) but never silently dropped.
type DeadLetter struct {
	ReceivedAt time.Time `json:"received_at"`
	MessageID  string    `json:"message_id"`
	Error      string    `json:"error"`
	Payload    string    `json:"payload"`
}

// Outcome values.
const (
	OutcomeSuccess = "success"
	OutcomeFailure = "failure"
)
