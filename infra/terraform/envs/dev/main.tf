locals {
  apis = [
    "artifactregistry.googleapis.com",
    "bigquery.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sts.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# One identity per job, each with only the grants it needs.
resource "google_service_account" "pipeline" {
  project      = var.project_id
  account_id   = "falcon-pipeline"
  display_name = "Falcon pipeline runtime"
  depends_on   = [google_project_service.apis]
}

resource "google_service_account" "pusher" {
  project      = var.project_id
  account_id   = "falcon-pubsub-pusher"
  display_name = "Falcon Pub/Sub push identity (run.invoker only)"
  depends_on   = [google_project_service.apis]
}

resource "google_artifact_registry_repository" "falcon" {
  #checkov:skip=CKV_GCP_84:Google-managed encryption is acceptable for the demo.
  project       = var.project_id
  location      = var.region
  repository_id = "falcon"
  format        = "DOCKER"
  description   = "Falcon container images"
  depends_on    = [google_project_service.apis]

  docker_config {
    immutable_tags = true
  }
}

resource "google_secret_manager_secret" "slack_webhook" {
  #checkov:skip=CKV_GCP_76:Google-managed encryption is acceptable for the demo.
  count     = var.enable_slack ? 1 : 0
  project   = var.project_id
  secret_id = "falcon-slack-webhook"

  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

module "bigquery" {
  source              = "../../modules/bigquery"
  project_id          = var.project_id
  location            = var.region
  writer_member       = "serviceAccount:${google_service_account.pipeline.email}"
  reader_members      = var.bigquery_readers
  deletion_protection = var.deletion_protection
}

module "pipeline" {
  source                = "../../modules/pipeline-run"
  project_id            = var.project_id
  region                = var.region
  image                 = var.pipeline_image
  service_account_email = google_service_account.pipeline.email
  invoker_member        = "serviceAccount:${google_service_account.pusher.email}"
  bq_dataset            = module.bigquery.dataset_id
  slack_secret_id       = var.enable_slack ? google_secret_manager_secret.slack_webhook[0].secret_id : null
  deletion_protection   = var.deletion_protection
}

module "pubsub" {
  source                     = "../../modules/pubsub"
  project_id                 = var.project_id
  push_endpoint              = "${module.pipeline.uri}/pubsub/push"
  push_audience              = module.pipeline.uri
  push_service_account_email = google_service_account.pusher.email
}

module "log_sink" {
  source     = "../../modules/log-sink"
  project_id = var.project_id
  topic_id   = module.pubsub.topic_id
}

module "ci" {
  source                     = "../../modules/ci-identity"
  project_id                 = var.project_id
  region                     = var.region
  github_repository          = var.github_repository
  run_service_name           = module.pipeline.name
  artifact_repository_id     = google_artifact_registry_repository.falcon.repository_id
  runtime_service_account_id = google_service_account.pipeline.name
}
