# The backup bucket and its add-and-read-only account (RUNBOOK step 4, now code).
resource "google_storage_bucket" "backups" {
  name                        = var.backup_bucket
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_service_account" "backup" {
  account_id   = "dishkept-backup"
  display_name = "Dishkept backup"
  depends_on   = [google_project_service.iam]
}

# Create and view only: a compromised host can't delete or overwrite old backups.
resource "google_storage_bucket_iam_member" "backup_create" {
  bucket = google_storage_bucket.backups.name
  role   = "roles/storage.objectCreator"
  member = google_service_account.backup.member
}

resource "google_storage_bucket_iam_member" "backup_view" {
  bucket = google_storage_bucket.backups.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.backup.member
}

resource "google_service_account_key" "backup" {
  service_account_id = google_service_account.backup.name
}
