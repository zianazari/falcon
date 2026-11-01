// Package normalize turns a raw GCP LogEntry (as delivered by a log sink to
// Pub/Sub) into a normalized event.Event and enriches it.
package normalize

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"strings"
	"time"

	"falcon/pipeline/internal/event"
)

// ErrInvalid marks permanent parse failures: retrying will never succeed, so
// the caller should dead-letter the message instead of nacking it.
var ErrInvalid = errors.New("invalid log entry")

// logEntry is the subset of google.logging.v2.LogEntry we use.
type logEntry struct {
	InsertID     string          `json:"insertId"`
	LogName      string          `json:"logName"`
	Timestamp    time.Time       `json:"timestamp"`
	Severity     string          `json:"severity"`
	Resource     monitoredRes    `json:"resource"`
	ProtoPayload *auditLog       `json:"protoPayload"`
	JSONPayload  json.RawMessage `json:"jsonPayload"`
}

type monitoredRes struct {
	Type   string            `json:"type"`
	Labels map[string]string `json:"labels"`
}

// auditLog is the subset of google.cloud.audit.AuditLog we use.
type auditLog struct {
	Type               string `json:"@type"`
	ServiceName        string `json:"serviceName"`
	MethodName         string `json:"methodName"`
	ResourceName       string `json:"resourceName"`
	AuthenticationInfo struct {
		PrincipalEmail string `json:"principalEmail"`
	} `json:"authenticationInfo"`
	RequestMetadata struct {
		CallerIP                string `json:"callerIp"`
		CallerSuppliedUserAgent string `json:"callerSuppliedUserAgent"`
	} `json:"requestMetadata"`
	Status *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"status"`
	ServiceData *struct {
		PolicyDelta *struct {
			BindingDeltas []event.IAMDelta `json:"bindingDeltas"`
		} `json:"policyDelta"`
	} `json:"serviceData"`
}

// Normalize parses a LogEntry and returns the enriched event. now is the
// pipeline's receive time.
func Normalize(data []byte, now time.Time) (event.Event, error) {
	var le logEntry
	if err := json.Unmarshal(data, &le); err != nil {
		return event.Event{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if le.InsertID == "" || le.LogName == "" || le.Timestamp.IsZero() {
		return event.Event{}, fmt.Errorf("%w: insertId, logName and timestamp are required", ErrInvalid)
	}

	ev := event.Event{
		ID:         le.InsertID,
		Timestamp:  le.Timestamp.UTC(),
		ReceivedAt: now.UTC(),
		Source:     "gcp.log",
		LogType:    logType(le.LogName),
		Project:    projectID(le),
		Severity:   le.Severity,
		Outcome:    event.OutcomeSuccess,
		Raw:        json.RawMessage(data),
	}

	if p := le.ProtoPayload; p != nil && strings.HasSuffix(p.Type, "google.cloud.audit.AuditLog") {
		ev.Source = "gcp.audit"
		ev.Service = p.ServiceName
		ev.Action = p.MethodName
		ev.Resource = p.ResourceName
		ev.Actor = p.AuthenticationInfo.PrincipalEmail
		ev.SrcIP = p.RequestMetadata.CallerIP
		ev.UserAgent = p.RequestMetadata.CallerSuppliedUserAgent
		if p.Status != nil && p.Status.Code != 0 {
			ev.Outcome = event.OutcomeFailure
			ev.StatusCode = p.Status.Code
			ev.StatusMessage = p.Status.Message
		}
		if p.ServiceData != nil && p.ServiceData.PolicyDelta != nil {
			ev.IAMDeltas = p.ServiceData.PolicyDelta.BindingDeltas
		}
	}

	ev.ActorType = actorType(ev.Actor)
	ev.IPClass = ipClass(ev.SrcIP)
	return ev, nil
}

// logType maps ".../logs/cloudaudit.googleapis.com%2Factivity" to "admin_activity".
func logType(logName string) string {
	i := strings.LastIndex(logName, "/logs/")
	if i < 0 {
		return "unknown"
	}
	name := strings.ReplaceAll(logName[i+len("/logs/"):], "%2F", "/")
	switch name {
	case "cloudaudit.googleapis.com/activity":
		return "admin_activity"
	case "cloudaudit.googleapis.com/data_access":
		return "data_access"
	case "cloudaudit.googleapis.com/system_event":
		return "system_event"
	case "cloudaudit.googleapis.com/policy":
		return "policy_denied"
	}
	return name
}

func projectID(le logEntry) string {
	if p := le.Resource.Labels["project_id"]; p != "" {
		return p
	}
	// logName is "projects/<id>/logs/..."
	if rest, ok := strings.CutPrefix(le.LogName, "projects/"); ok {
		id, _, _ := strings.Cut(rest, "/")
		return id
	}
	return ""
}

func actorType(email string) string {
	switch {
	case email == "":
		return "anonymous"
	case strings.HasSuffix(email, "@system.gserviceaccount.com"),
		strings.Contains(email, "@gcp-sa-"),
		strings.HasSuffix(email, "@cloudservices.gserviceaccount.com"):
		return "google_managed"
	case strings.HasSuffix(email, ".gserviceaccount.com"):
		return "service_account"
	}
	return "user"
}

func ipClass(ip string) string {
	switch ip {
	case "":
		return "none"
	case "private", "gce-internal-ip":
		return "internal"
	}
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return "unknown"
	}
	if addr.IsPrivate() || addr.IsLoopback() || addr.IsLinkLocalUnicast() {
		return "internal"
	}
	return "public"
}
