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

# Issue #72: refuse floods of sign-in code requests at Cloudflare, before they
# reach the house. The free plan allows one rule, a 10-second period, counting
# per address and data centre, and the path in the expression. The API's own
# per-email lockout and GoTrue's per-address limits do the fine-grained work.
resource "cloudflare_ruleset" "sign_in_rate_limit" {
  zone_id     = cloudflare_zone.site.id
  name        = "Sign-in code rate limit"
  description = "Email code requests and checks, per address"
  kind        = "zone"
  phase       = "http_ratelimit"

  rules {
    description = "More than 10 code requests or checks in 10 seconds from one address"
    expression  = "(http.request.uri.path eq \"/api/auth/otp\") or (http.request.uri.path eq \"/api/auth/verify\")"
    action      = "block"
    enabled     = true
    ratelimit {
      characteristics     = ["cf.colo.id", "ip.src"]
      period              = 10
      requests_per_period = 10
      mitigation_timeout  = 10
    }
  }
}
