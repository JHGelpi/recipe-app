# Dishkept's cloud resources (infrastructure spec §3, ADR-0021).
terraform {
  required_version = ">= 1.8"
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.52" }
    google     = { source = "hashicorp/google", version = "~> 6.0" }
    random     = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # The bucket is given at init: tofu init -backend-config=bucket=<project>-dishkept-tofu-state
  backend "gcs" {
    prefix = "dishkept"
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment.
provider "cloudflare" {}

# Uses application-default credentials (gcloud auth application-default login).
provider "google" {
  project = var.project
  region  = var.region
}

variable "project" {
  type        = string
  description = "The GCP project id"
}

variable "region" {
  type    = string
  default = "us-east1"
}

variable "zone" {
  type    = string
  default = "us-east1-b"
}

variable "cloudflare_account_id" {
  type        = string
  description = "The Cloudflare account id (dashboard sidebar)"
}

variable "domain" {
  type    = string
  default = "geltech.dev"
}

variable "hostname" {
  type    = string
  default = "dishkept"
}

variable "backup_bucket" {
  type        = string
  description = "The backup bucket's globally unique name"
}

variable "owner_member" {
  type        = string
  description = "Who may SSH to the VM, as an IAM member: user:you@example.com"
}

variable "machine_type" {
  type        = string
  default     = "e2-micro"
  description = "The VM's size; e2-micro is in the free tier (1 GB, with a swap file)"
}

variable "vm" {
  type        = bool
  default     = false
  description = "Create the VM (the trial, or the move off the PC)"
}
