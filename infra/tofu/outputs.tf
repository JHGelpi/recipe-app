output "nameservers" {
  description = "Paste these at Porkbun as geltech.dev's authoritative nameservers"
  value       = cloudflare_zone.site.name_servers
}

output "tunnel_token" {
  value     = cloudflare_zero_trust_tunnel_cloudflared.dishkept.tunnel_token
  sensitive = true
}

output "backup_bucket" {
  value = google_storage_bucket.backups.name
}

output "backup_key_json" {
  value     = base64decode(google_service_account_key.backup.private_key)
  sensitive = true
}

# Empty, not an error, when there is no VM (Review Focus 5).
output "vm_name" {
  value = try(google_compute_instance.dishkept[0].name, "")
}

output "vm_zone" {
  value = try(google_compute_instance.dishkept[0].zone, "")
}
