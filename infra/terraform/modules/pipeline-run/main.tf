# The Go pipeline on Cloud Run. Internal ingress only, so the service is not
# reachable from the internet. Pub/Sub push in the same project counts as
# internal, and only the push identity holds run.invoker.

variable "project_id" { type = string }
variable "region" { type = string }

variable "name" {
  type    = string
  default = "falcon-pipeline"
}

variable "image" {
  type        = string
  description = "Initial image. CI deploys new revisions, so later changes are ignored."
}

variable "service_account_email" { type = string }

variable "invoker_member" {
  type        = string
  description = "The Pub/Sub push identity."
}

variable "bq_dataset" { type = string }

variable "slack_secret_id" {
  type        = string
  description = "Secret Manager secret holding the Slack webhook URL; null disables Slack."
  default     = null
}

variable "max_instances" {
  type    = number
  default = 10
}

variable "deletion_protection" {
  type    = bool
  default = true
}

resource "google_cloud_run_v2_service" "pipeline" {
  project             = var.project_id
  name                = var.name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = var.deletion_protection

  template {
    service_account                  = var.service_account_email
    max_instance_request_concurrency = 80

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      env {
        name  = "SINK"
        value = "bigquery"
      }
      env {
        name  = "BQ_PROJECT"
        value = var.project_id
      }
      env {
        name  = "BQ_DATASET"
        value = var.bq_dataset
      }

      dynamic "env" {
        for_each = var.slack_secret_id == null ? [] : [var.slack_secret_id]
        content {
          name = "SLACK_WEBHOOK_URL"
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}

resource "google_cloud_run_v2_service_iam_member" "invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.pipeline.name
  role     = "roles/run.invoker"
  member   = var.invoker_member
}

# Access to this one secret only.
resource "google_secret_manager_secret_iam_member" "slack" {
  count     = var.slack_secret_id == null ? 0 : 1
  project   = var.project_id
  secret_id = var.slack_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.service_account_email}"
}

output "uri" {
  value = google_cloud_run_v2_service.pipeline.uri
}

output "name" {
  value = google_cloud_run_v2_service.pipeline.name
}
