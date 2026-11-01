variable "project_id" {
  type        = string
  description = "GCP project to deploy into."
}

variable "region" {
  type    = string
  default = "europe-north1" # Finland
}

variable "github_repository" {
  type        = string
  description = "owner/name of the repository whose main branch may deploy."
}

variable "pipeline_image" {
  type        = string
  description = "Bootstrap image for the first apply. CI replaces it with the real pipeline image."
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "enable_slack" {
  type        = bool
  description = "Create the Slack webhook secret and wire it into the pipeline. Add the secret version manually."
  default     = false
}

variable "bigquery_readers" {
  type        = list(string)
  description = "Principals that can query security data (e.g. group:security@example.com)."
  default     = []
}

variable "deletion_protection" {
  type    = bool
  default = true
}
