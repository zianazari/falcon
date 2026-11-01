package normalize

import (
	"errors"
	"testing"
	"time"
)

const saKeyEntry = `{
  "insertId": "abc123",
  "logName": "projects/falcon-demo/logs/cloudaudit.googleapis.com%2Factivity",
  "timestamp": "2026-10-01T12:00:00Z",
  "severity": "NOTICE",
  "resource": {"type": "service_account", "labels": {"project_id": "falcon-demo"}},
  "protoPayload": {
    "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
    "serviceName": "iam.googleapis.com",
    "methodName": "google.iam.admin.v1.CreateServiceAccountKey",
    "resourceName": "projects/-/serviceAccounts/123",
    "authenticationInfo": {"principalEmail": "mallory@corp.example"},
    "requestMetadata": {"callerIp": "203.0.113.66", "callerSuppliedUserAgent": "curl/8.0"}
  }
}`

func TestNormalizeAuditLog(t *testing.T) {
	now := time.Date(2026, 10, 1, 12, 0, 5, 0, time.UTC)
	ev, err := Normalize([]byte(saKeyEntry), now)
	if err != nil {
		t.Fatal(err)
	}
	checks := map[string][2]string{
		"id":         {ev.ID, "abc123"},
		"source":     {ev.Source, "gcp.audit"},
		"log_type":   {ev.LogType, "admin_activity"},
		"service":    {ev.Service, "iam.googleapis.com"},
		"action":     {ev.Action, "google.iam.admin.v1.CreateServiceAccountKey"},
		"project":    {ev.Project, "falcon-demo"},
		"actor":      {ev.Actor, "mallory@corp.example"},
		"actor_type": {ev.ActorType, "user"},
		"ip_class":   {ev.IPClass, "public"},
		"outcome":    {ev.Outcome, "success"},
	}
	for name, c := range checks {
		if c[0] != c[1] {
			t.Errorf("%s = %q, want %q", name, c[0], c[1])
		}
	}
	if !ev.ReceivedAt.Equal(now) {
		t.Errorf("received_at = %v", ev.ReceivedAt)
	}
}

func TestNormalizeFailureAndDeltas(t *testing.T) {
	entry := `{
	  "insertId": "x1", "logName": "projects/p1/logs/cloudaudit.googleapis.com%2Factivity",
	  "timestamp": "2026-10-01T12:00:00Z",
	  "protoPayload": {
	    "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
	    "methodName": "SetIamPolicy",
	    "authenticationInfo": {"principalEmail": "deployer@p1.iam.gserviceaccount.com"},
	    "requestMetadata": {"callerIp": "10.1.2.3"},
	    "status": {"code": 7, "message": "PERMISSION_DENIED"},
	    "serviceData": {"policyDelta": {"bindingDeltas": [
	      {"action": "ADD", "role": "roles/owner", "member": "user:eve@gmail.com"}
	    ]}}
	  }
	}`
	ev, err := Normalize([]byte(entry), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if ev.Outcome != "failure" || ev.StatusCode != 7 {
		t.Errorf("outcome = %s/%d, want failure/7", ev.Outcome, ev.StatusCode)
	}
	if ev.ActorType != "service_account" || ev.IPClass != "internal" || ev.Project != "p1" {
		t.Errorf("enrichment wrong: %s %s %s", ev.ActorType, ev.IPClass, ev.Project)
	}
	if len(ev.IAMDeltas) != 1 || ev.IAMDeltas[0].Role != "roles/owner" {
		t.Errorf("iam deltas = %+v", ev.IAMDeltas)
	}
}

func TestNormalizeInvalid(t *testing.T) {
	for name, in := range map[string]string{
		"not json":       "this is not json {",
		"missing fields": `{"insertId": "a"}`,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := Normalize([]byte(in), time.Now())
			if !errors.Is(err, ErrInvalid) {
				t.Fatalf("err = %v, want ErrInvalid", err)
			}
		})
	}
}

func TestActorType(t *testing.T) {
	cases := map[string]string{
		"":                                "anonymous",
		"alice@corp.example":              "user",
		"ci@proj.iam.gserviceaccount.com": "service_account",
		"service-1@gcp-sa-pubsub.iam.gserviceaccount.com": "google_managed",
		"123@cloudservices.gserviceaccount.com":           "google_managed",
	}
	for in, want := range cases {
		if got := actorType(in); got != want {
			t.Errorf("actorType(%q) = %q, want %q", in, got, want)
		}
	}
}
