package main

import (
	"fmt"
	"math/rand/v2"
	"time"
)

const (
	project  = "falcon-demo-prod"
	attacker = "mallory@corp.example"
	badIP    = "203.0.113.66"
	ciSA     = "ci-deployer@falcon-demo-prod.iam.gserviceaccount.com"
	apiSA    = "api-backend@falcon-demo-prod.iam.gserviceaccount.com"
)

// gen builds GCP audit LogEntries shaped like what a log sink publishes.
type gen struct {
	runID string
	now   time.Time
	seq   int
}

func newGen(runID string, now time.Time) *gen { return &gen{runID: runID, now: now} }

type spec struct {
	method, service, resource, actor, ip, log, resType string
	request                                            map[string]any
	deltas                                             []map[string]string
	denied                                             bool
}

func (g *gen) entry(kind string, s spec) map[string]any {
	g.seq++
	if s.ip == "" {
		s.ip = badIP
	}
	if s.log == "" {
		s.log = "activity"
	}
	if s.resType == "" {
		s.resType = "project"
	}
	pp := map[string]any{
		"@type":              "type.googleapis.com/google.cloud.audit.AuditLog",
		"serviceName":        s.service,
		"methodName":         s.method,
		"resourceName":       s.resource,
		"authenticationInfo": map[string]any{"principalEmail": s.actor},
		"requestMetadata":    map[string]any{"callerIp": s.ip, "callerSuppliedUserAgent": "google-cloud-sdk gcloud/495.0.0"},
	}
	if s.request != nil {
		pp["request"] = s.request
	}
	if s.deltas != nil {
		pp["serviceData"] = map[string]any{"policyDelta": map[string]any{"bindingDeltas": s.deltas}}
	}
	if s.denied {
		pp["status"] = map[string]any{"code": 7, "message": "PERMISSION_DENIED"}
	}
	ts := g.now.Add(time.Duration(g.seq) * time.Second).Format(time.RFC3339Nano)
	return map[string]any{
		"insertId":     fmt.Sprintf("sim-%s-%s-%03d", g.runID, kind, g.seq),
		"logName":      fmt.Sprintf("projects/%s/logs/cloudaudit.googleapis.com%%2F%s", project, s.log),
		"timestamp":    ts,
		"severity":     "NOTICE",
		"resource":     map[string]any{"type": s.resType, "labels": map[string]string{"project_id": project}},
		"protoPayload": pp,
	}
}

type step struct {
	desc, rule string
	entry      map[string]any
}

// attackStory is a compromised-account kill chain: harvest credentials,
// persist, escalate, open access, exfiltrate, cover tracks.
func attackStory(g *gen) []step {
	return []step{
		{"Read the Stripe API key from Secret Manager", "gcp-secret-accessed-by-human", g.entry("attack", spec{
			method: "google.cloud.secretmanager.v1.SecretManagerService.AccessSecretVersion", service: "secretmanager.googleapis.com",
			resource: "projects/123456789/secrets/stripe-api-key/versions/latest", actor: attacker, log: "data_access", resType: "audited_resource",
		})},
		{"Create a key for the CI deployer service account", "gcp-sa-key-created", g.entry("attack", spec{
			method: "google.iam.admin.v1.CreateServiceAccountKey", service: "iam.googleapis.com",
			resource: "projects/-/serviceAccounts/" + ciSA, actor: attacker, resType: "service_account",
		})},
		{"Grant roles/owner to an external Gmail account", "gcp-privileged-role-granted", g.entry("attack", spec{
			method: "SetIamPolicy", service: "cloudresourcemanager.googleapis.com", resource: "projects/" + project, actor: attacker,
			deltas: []map[string]string{{"action": "ADD", "role": "roles/owner", "member": "user:mallory.backdoor@gmail.com"}},
		})},
		{"Open SSH (tcp:22) to 0.0.0.0/0", "gcp-firewall-open-to-internet", g.entry("attack", spec{
			method: "v1.compute.firewalls.insert", service: "compute.googleapis.com",
			resource: "projects/" + project + "/global/firewalls/allow-ssh-debug", actor: attacker, resType: "gce_firewall_rule",
			request: map[string]any{"direction": "INGRESS", "sourceRanges": []string{"0.0.0.0/0"},
				"alloweds": []map[string]any{{"IPProtocol": "tcp", "ports": []string{"22"}}}},
		})},
		{"Make the customer-exports bucket public", "gcp-bucket-made-public", g.entry("attack", spec{
			method: "storage.setIamPermissions", service: "storage.googleapis.com", resource: "projects/_/buckets/customer-exports",
			actor: attacker, resType: "gcs_bucket",
			deltas: []map[string]string{{"action": "ADD", "role": "roles/storage.objectViewer", "member": "allUsers"}},
		})},
		{"Delete the audit log sink that feeds Falcon", "gcp-audit-logging-tampered", g.entry("attack", spec{
			method: "google.logging.v2.ConfigServiceV2.DeleteSink", service: "logging.googleapis.com",
			resource: "projects/" + project + "/sinks/falcon-audit-sink", actor: attacker, resType: "logging_sink",
		})},
	}
}

// benign returns ordinary activity, including near-misses that a sloppy rule
// would flag: workloads reading secrets, denied attempts, internal firewalls.
func (g *gen) benign(i int) map[string]any {
	users := []string{"alice@corp.example", "bob@corp.example", "carol@corp.example"}
	user := users[rand.IntN(len(users))]
	internal := fmt.Sprintf("10.8.%d.%d", rand.IntN(4), 2+rand.IntN(200))
	templates := []spec{
		{method: "google.cloud.run.v2.Services.UpdateService", service: "run.googleapis.com",
			resource: "projects/" + project + "/locations/europe-north1/services/api", actor: ciSA, ip: internal},
		{method: "google.cloud.secretmanager.v1.SecretManagerService.AccessSecretVersion", service: "secretmanager.googleapis.com",
			resource: "projects/123456789/secrets/db-password/versions/3", actor: apiSA, ip: internal, log: "data_access"},
		{method: "SetIamPolicy", service: "cloudresourcemanager.googleapis.com", resource: "projects/" + project, actor: user, ip: "198.51.100.10",
			deltas: []map[string]string{{"action": "ADD", "role": "roles/viewer", "member": "user:dave@corp.example"}}},
		{method: "google.iam.admin.v1.CreateServiceAccountKey", service: "iam.googleapis.com",
			resource: "projects/-/serviceAccounts/" + ciSA, actor: user, ip: "198.51.100.10", denied: true},
		{method: "v1.compute.firewalls.insert", service: "compute.googleapis.com",
			resource: "projects/" + project + "/global/firewalls/allow-internal", actor: user, ip: "198.51.100.10",
			request: map[string]any{"direction": "INGRESS", "sourceRanges": []string{"10.0.0.0/8"}}},
		{method: "google.logging.v2.ConfigServiceV2.ListSinks", service: "logging.googleapis.com",
			resource: "projects/" + project, actor: user, ip: "198.51.100.10", log: "data_access"},
		{method: "storage.objects.create", service: "storage.googleapis.com",
			resource: "projects/_/buckets/build-cache/objects/app.tar.gz", actor: ciSA, ip: internal, log: "data_access"},
		{method: "v1.compute.instances.start", service: "compute.googleapis.com",
			resource: "projects/" + project + "/zones/europe-north1-a/instances/worker-1", actor: user, ip: "198.51.100.10"},
	}
	return g.entry("benign", templates[i%len(templates)])
}
