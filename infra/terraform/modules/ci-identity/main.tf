# Keyless CI: GitHub Actions exchanges its OIDC token for a short-lived
# credential for the deployer service account. No JSON key exists to leak.
# Only workflows on main in the given repository can do this.

variable "project_id" { type = string }
variable "region" { type = string }

variable "github_repository" {
  type        = string
  description = "owner/name of the repository allowed to deploy."
}

variable "run_service_name" { type = string }
variable "artifact_repository_id" { type = string }

variable "runtime_service_account_id" {
  type        = string
  description = "Full ID of the pipeline service account (the deployer must act as it)."
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  #checkov:skip=CKV_GCP_125:The condition pins the exact sub claim; Checkov cannot resolve var.github_repository inside a module (it passes with a literal value).
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "falcon"
  display_name                       = "falcon repository"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  # Without a condition, any GitHub repository could use this provider. The
  # exact sub claim pins both the repository and the main branch. (A job that
  # uses a GitHub `environment:` gets a different sub, so the deploy job has none.)
  attribute_condition = "assertion.sub == 'repo:${var.github_repository}:ref:refs/heads/main'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "falcon-deployer"
  display_name = "Falcon CI deployer"
}

resource "google_service_account_iam_member" "github_impersonation" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# Everything below is scoped to a single resource, not the project.
resource "google_artifact_registry_repository_iam_member" "push" {
  project    = var.project_id
  location   = var.region
  repository = var.artifact_repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_cloud_run_v2_service_iam_member" "deploy" {
  project  = var.project_id
  location = var.region
  name     = var.run_service_name
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "act_as_runtime" {
  service_account_id = var.runtime_service_account_id
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

output "workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_email" {
  value = google_service_account.deployer.email
}
