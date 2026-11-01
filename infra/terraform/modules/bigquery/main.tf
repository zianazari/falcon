# Security data lake: normalized events, alerts and dead letters.
# The schemas in ./schemas must match pipeline/internal/sink/bigquery.go.

variable "project_id" { type = string }
variable "location" { type = string }

variable "dataset_id" {
  type    = string
  default = "falcon_security"
}

variable "writer_member" {
  type        = string
  description = "Pipeline identity. Gets dataEditor on this dataset only, not project-wide."
}

variable "reader_members" {
  type        = list(string)
  description = "Who can query (e.g. group:security@example.com). Feeds dashboards."
  default     = []
}

variable "event_retention_days" {
  type    = number
  default = 400
}

variable "deletion_protection" {
  type    = bool
  default = true
}

resource "google_bigquery_dataset" "this" {
  #checkov:skip=CKV_GCP_81:Google-managed encryption is acceptable for the demo; set default_encryption_configuration in production.
  project                    = var.project_id
  dataset_id                 = var.dataset_id
  location                   = var.location
  description                = "Falcon security events and alerts"
  delete_contents_on_destroy = false
}

resource "google_bigquery_table" "events" {
  #checkov:skip=CKV_GCP_80:Google-managed encryption is acceptable for the demo.
  project             = var.project_id
  dataset_id          = google_bigquery_dataset.this.dataset_id
  table_id            = "events"
  schema              = file("${path.module}/schemas/events.json")
  clustering          = ["action", "actor"]
  deletion_protection = var.deletion_protection

  time_partitioning {
    type          = "DAY"
    field         = "ts"
    expiration_ms = var.event_retention_days * 86400000
  }
}

resource "google_bigquery_table" "alerts" {
  #checkov:skip=CKV_GCP_80:Google-managed encryption is acceptable for the demo.
  project             = var.project_id
  dataset_id          = google_bigquery_dataset.this.dataset_id
  table_id            = "alerts"
  schema              = file("${path.module}/schemas/alerts.json")
  clustering          = ["rule_id", "severity"]
  deletion_protection = var.deletion_protection

  time_partitioning {
    type  = "DAY"
    field = "detected_at"
  }
}

resource "google_bigquery_table" "deadletter" {
  #checkov:skip=CKV_GCP_80:Google-managed encryption is acceptable for the demo.
  project             = var.project_id
  dataset_id          = google_bigquery_dataset.this.dataset_id
  table_id            = "deadletter"
  schema              = file("${path.module}/schemas/deadletter.json")
  deletion_protection = var.deletion_protection

  time_partitioning {
    type          = "DAY"
    field         = "received_at"
    expiration_ms = 30 * 86400000
  }
}

resource "google_bigquery_dataset_iam_member" "writer" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.this.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = var.writer_member
}

resource "google_bigquery_dataset_iam_member" "readers" {
  for_each   = toset(var.reader_members)
  project    = var.project_id
  dataset_id = google_bigquery_dataset.this.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = each.value
}

output "dataset_id" {
  value = google_bigquery_dataset.this.dataset_id
}
