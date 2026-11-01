# Audit-log topic, an authenticated push subscription to the pipeline, and a
# dead-letter topic for messages that keep failing.

variable "project_id" { type = string }

variable "name" {
  type    = string
  default = "falcon-audit-logs"
}

variable "push_endpoint" {
  type        = string
  description = "Pipeline push URL (Cloud Run URL + /pubsub/push)."
}

variable "push_audience" {
  type        = string
  description = "OIDC audience. Cloud Run expects its service URL."
}

variable "push_service_account_email" {
  type        = string
  description = "Identity Pub/Sub signs push requests as. Holds run.invoker on the pipeline, and nothing else."
}

variable "max_delivery_attempts" {
  type    = number
  default = 5
}

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  pubsub_agent = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_topic" "logs" {
  #checkov:skip=CKV_GCP_83:Google-managed encryption is acceptable for the demo; set kms_key_name in production.
  project                    = var.project_id
  name                       = var.name
  message_retention_duration = "86400s"
}

resource "google_pubsub_topic" "dead_letter" {
  #checkov:skip=CKV_GCP_83:Google-managed encryption is acceptable for the demo; set kms_key_name in production.
  project = var.project_id
  name    = "${var.name}-dead-letter"
}

# Messages land here after max_delivery_attempts. Inspect them with
# `gcloud pubsub subscriptions pull`, fix the cause, then replay.
resource "google_pubsub_subscription" "dead_letter" {
  project                    = var.project_id
  name                       = "${var.name}-dead-letter-pull"
  topic                      = google_pubsub_topic.dead_letter.id
  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"

  expiration_policy {
    ttl = ""
  }
}

resource "google_pubsub_subscription" "push" {
  project              = var.project_id
  name                 = "${var.name}-pipeline-push"
  topic                = google_pubsub_topic.logs.id
  ack_deadline_seconds = 60

  push_config {
    push_endpoint = var.push_endpoint
    oidc_token {
      service_account_email = var.push_service_account_email
      audience              = var.push_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = var.max_delivery_attempts
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  expiration_policy {
    ttl = ""
  }
}

# The Pub/Sub service agent must publish to the dead-letter topic, ack on the
# source subscription, and mint OIDC tokens for the push identity.
resource "google_pubsub_topic_iam_member" "agent_dead_letter_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.dead_letter.name
  role    = "roles/pubsub.publisher"
  member  = local.pubsub_agent
}

resource "google_pubsub_subscription_iam_member" "agent_source_subscriber" {
  project      = var.project_id
  subscription = google_pubsub_subscription.push.name
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_agent
}

resource "google_service_account_iam_member" "agent_token_creator" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.push_service_account_email}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = local.pubsub_agent
}

output "topic_id" {
  value = google_pubsub_topic.logs.id
}

output "dead_letter_subscription" {
  value = google_pubsub_subscription.dead_letter.name
}
