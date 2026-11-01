terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 8.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6, < 4.0"
    }
  }

  # Local state by default. For a shared environment use a versioned GCS bucket:
  # backend "gcs" {
  #   bucket = "<project>-tfstate"
  #   prefix = "falcon/dev"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
