# The zone, the tunnel and its public hostname (RUNBOOK steps 1–2, now code).
resource "cloudflare_zone" "site" {
  account_id = var.cloudflare_account_id
  zone       = var.domain
  plan       = "free"
}

resource "random_id" "tunnel_secret" {
  byte_length = 32
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "dishkept" {
  account_id = var.cloudflare_account_id
  name       = "dishkept"
  secret     = random_id.tunnel_secret.b64_std
  config_src = "cloudflare"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "dishkept" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.dishkept.id
  config {
    ingress_rule {
      hostname = "${var.hostname}.${var.domain}"
      service  = "http://proxy:8080"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

resource "cloudflare_record" "app" {
  zone_id = cloudflare_zone.site.id
  name    = var.hostname
  type    = "CNAME"
  content = cloudflare_zero_trust_tunnel_cloudflared.dishkept.cname
  proxied = true
}
