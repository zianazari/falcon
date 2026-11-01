output "pipeline_url" {
  value = module.pipeline.uri
}

output "audit_topic" {
  value = module.pubsub.topic_id
}

output "dead_letter_subscription" {
  value = module.pubsub.dead_letter_subscription
}

output "bigquery_dataset" {
  value = module.bigquery.dataset_id
}

output "image_repository" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.falcon.repository_id}"
}

# Set these as GitHub Actions variables for .github/workflows/deploy.yml.
output "github_actions_variables" {
  value = {
    GCP_PROJECT_ID        = var.project_id
    GCP_REGION            = var.region
    GCP_WORKLOAD_IDENTITY = module.ci.workload_identity_provider
    GCP_DEPLOYER_SA       = module.ci.deployer_email
    GCP_IMAGE_REPOSITORY  = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.falcon.repository_id}"
    GCP_PIPELINE_SERVICE  = module.pipeline.name
  }
}
