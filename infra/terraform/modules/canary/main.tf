# Heartbeat that proves audit logs still reach the pipeline. Rules cannot see an
# event that never arrives, and Cloud Logging drops exports without an error.
# One job updates a dedicated topic, which writes an audit entry; the other asks
# the pipeline whether a recent entry has landed.

variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "scheduler_region" {
  type        = string
  description = "Cloud Scheduler is not offered in every region, including europe-north1."
  default     = "europe-west1"
}

variable "pipeline_uri" {
  type = string
}

variable "pipeline_name" {
  type = string
}

variable "schedule" {
  type    = string
  default = "*/5 * * * *"
}

resource "google_service_account" "canary" {
  project      = var.project_id
  account_id   = "falcon-canary"
  display_name = "Falcon audit log canary"
}

resource "google_pubsub_topic" "canary" {
  #checkov:skip=CKV_GCP_83:Carries no messages; only its metadata is updated.
  project = var.project_id
  name    = "falcon-canary"
}

# Enough to update this one topic, and nothing else in the project.
resource "google_pubsub_topic_iam_member" "updater" {
  project = var.project_id
  topic   = google_pubsub_topic.canary.name
  role    = "roles/pubsub.editor"
  member  = "serviceAccount:${google_service_account.canary.email}"
}

resource "google_cloud_run_v2_service_iam_member" "checker" {
  project  = var.project_id
  location = var.region
  name     = var.pipeline_name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.canary.email}"
}

resource "google_cloud_scheduler_job" "heartbeat" {
  project          = var.project_id
  region           = var.scheduler_region
  name             = "falcon-canary-heartbeat"
  description      = "Writes one audit log entry by updating the canary topic"
  schedule         = var.schedule
  attempt_deadline = "60s"

  http_target {
    http_method = "PATCH"
    uri         = "https://pubsub.googleapis.com/v1/${google_pubsub_topic.canary.id}"
    headers     = { "Content-Type" = "application/json" }
    body = base64encode(jsonencode({
      topic      = { labels = { purpose = "falcon-canary" } }
      updateMask = "labels"
    }))

    oauth_token {
      service_account_email = google_service_account.canary.email
    }
  }

  depends_on = [google_pubsub_topic_iam_member.updater]
}

resource "google_cloud_scheduler_job" "check" {
  project          = var.project_id
  region           = var.scheduler_region
  name             = "falcon-canary-check"
  description      = "Asks the pipeline whether a recent canary event arrived"
  schedule         = var.schedule
  attempt_deadline = "60s"

  http_target {
    http_method = "POST"
    uri         = "${var.pipeline_uri}/canary/check"

    oidc_token {
      service_account_email = google_service_account.canary.email
      audience              = var.pipeline_uri
    }
  }

  depends_on = [google_cloud_run_v2_service_iam_member.checker]
}
