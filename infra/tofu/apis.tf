# APIs a fresh project needs before anything else (final review 7): the service account
# needs IAM, and IAM bindings need Resource Manager. Left on when removed.
resource "google_project_service" "iam" {
  service            = "iam.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "resource_manager" {
  service            = "cloudresourcemanager.googleapis.com"
  disable_on_destroy = false
}
