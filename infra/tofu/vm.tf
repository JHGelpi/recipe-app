# The VM, only while var.vm is true (infrastructure spec §3): no external IP,
# outbound through Cloud NAT, SSH only through IAP with OS Login.
resource "google_project_service" "compute" {
  count              = var.vm ? 1 : 0
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "iap" {
  count              = var.vm ? 1 : 0
  service            = "iap.googleapis.com"
  disable_on_destroy = false
}

resource "google_compute_network" "dishkept" {
  count                   = var.vm ? 1 : 0
  name                    = "dishkept"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.compute]
}

resource "google_compute_subnetwork" "dishkept" {
  count         = var.vm ? 1 : 0
  name          = "dishkept"
  region        = var.region
  network       = google_compute_network.dishkept[0].id
  ip_cidr_range = "10.10.0.0/24"
}

resource "google_compute_router" "dishkept" {
  count   = var.vm ? 1 : 0
  name    = "dishkept"
  region  = var.region
  network = google_compute_network.dishkept[0].id
}

resource "google_compute_router_nat" "dishkept" {
  count                              = var.vm ? 1 : 0
  name                               = "dishkept"
  router                             = google_compute_router.dishkept[0].name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

resource "google_compute_firewall" "iap_ssh" {
  count         = var.vm ? 1 : 0
  name          = "dishkept-iap-ssh"
  network       = google_compute_network.dishkept[0].id
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["dishkept"]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_project_iam_member" "os_admin_login" {
  count      = var.vm ? 1 : 0
  project    = var.project
  role       = "roles/compute.osAdminLogin"
  member     = var.owner_member
  depends_on = [google_project_service.resource_manager]
}

resource "google_project_iam_member" "iap_tunnel" {
  count      = var.vm ? 1 : 0
  project    = var.project
  role       = "roles/iap.tunnelResourceAccessor"
  member     = var.owner_member
  depends_on = [google_project_service.resource_manager]
}

resource "google_compute_instance" "dishkept" {
  count        = var.vm ? 1 : 0
  name         = "dishkept-vm"
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["dishkept"]
  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      # The free tier's disk: 30 GB of standard persistent disk.
      size = 30
      type = "pd-standard"
    }
  }
  network_interface {
    subnetwork = google_compute_subnetwork.dishkept[0].id
  }
  metadata = {
    enable-oslogin = "TRUE"
  }
  depends_on = [google_compute_router_nat.dishkept]
}
