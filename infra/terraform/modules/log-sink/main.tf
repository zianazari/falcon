# Routes Cloud Audit Logs to the pipeline topic, and turns on the Data Access
# logs that detections depend on (they are off by default).
#
# For an organization, swap this for google_logging_organization_sink with
# include_children = true, so new projects are covered automatically.

variable "project_id" { type = string }

variable "topic_id" {
  type        = string
  description = "Destination topic, projects/<p>/topics/<t>."
}

variable "name" {
  type    = string
  default = "falcon-audit-sink"
}

variable "filter" {
  type        = string
  description = "Logging query for what to ship. Default: all audit logs, plus failed Cloud Scheduler runs so a broken canary job raises an alert."
  default     = "logName:\"cloudaudit.googleapis.com\" OR (resource.type=\"cloud_scheduler_job\" AND severity>=ERROR)"
}

variable "data_access_services" {
  type        = list(string)
  description = "Services to enable DATA_READ audit logs for. Keep the list short: data access logs are high volume and billed."
  default     = ["secretmanager.googleapis.com"]
}

resource "google_logging_project_sink" "audit" {
  project                = var.project_id
  name                   = var.name
  destination            = "pubsub.googleapis.com/${var.topic_id}"
  filter                 = var.filter
  unique_writer_identity = true
}

# The sink's own identity gets publish on this one topic only.
resource "google_pubsub_topic_iam_member" "sink_writer" {
  project = var.project_id
  topic   = var.topic_id
  role    = "roles/pubsub.publisher"
  member  = google_logging_project_sink.audit.writer_identity
}

resource "google_project_iam_audit_config" "data_access" {
  for_each = toset(var.data_access_services)
  project  = var.project_id
  service  = each.value

  audit_log_config {
    log_type = "DATA_READ"
  }
}

output "sink_name" {
  value = google_logging_project_sink.audit.name
}

output "writer_identity" {
  value = google_logging_project_sink.audit.writer_identity
}
