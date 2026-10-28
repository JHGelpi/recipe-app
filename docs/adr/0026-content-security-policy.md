# 0026. A strict Content-Security-Policy and security headers at the proxy

- **Status:** Accepted
- **Date:** 2026-10-28

## Context
The GoTrue session, refresh token included, lives in `localStorage`, so any script running in the app's origin can take over the account. The app shows content from untrusted sources: imported pages, AI drafts, and other households' shared snapshots. Nothing contained a rendering mistake or a compromised dependency, and nothing stopped another site from framing the app for clickjacking (issue #64).

## Decision
Caddy's `(app)` snippet sends, on every response:
- **`Content-Security-Policy`, enforced:**
  - `default-src 'self'`.
  - `script-src 'self' 'wasm-unsafe-eval'` plus the hash of the one inline script in `apps/mobile/public/index.html`, the theme bootstrap of ADR-0020. PowerSync's SQLite is WASM.
  - `style-src 'self' 'unsafe-inline'`, because react-native-web writes styles inline.
  - `img-src 'self' blob: data:`, for photos from local storage.
  - `worker-src 'self' blob:`, `connect-src 'self'`, `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'self'`, `object-src 'none'`.
- **Other headers:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` that allows the camera only for this origin. The `Server` header is removed.
- **`Strict-Transport-Security`** only when Cloudflare says the visitor came over HTTPS (`X-Forwarded-Proto: https`). HSTS covers a host on every port, so plain `http://localhost` must never receive it.
- **Guards:**
  - `apps/mobile/src/theme/csp.test.ts` fails when the inline script changes without its hash in the Caddyfile, and prints the new hash.
  - `apps/api/tests/stack/security-headers.test.ts` checks the headers on the app, an app route and the API.

## Alternatives considered
- **Report-only first:** it would show violations without breaking anything, but there is no reporting endpoint. Instead, the whole e2e suite ran under the enforced policy in Chromium, Firefox and WebKit before this shipped; every failure there also failed with the policy bypassed (the suite targets Chromium, and Firefox only for its tagged tests).
- **A nonce for the inline script:** needs a server that rewrites `index.html` per request. The page is a static file, and one hash suffices.
- **Moving the theme script to a file:** removes the hash, but the script must run before the first paint. A blocking external script delays the page more than the hash costs.

## Consequences
- New code must not add inline scripts, `eval`, or resources from other origins. Each would need a change here, which this ADR's reasoning should resist.
- Editing the theme script in `index.html` means updating its hash in the Caddyfile. The unit test says so.
- Zod 4's JIT probe (`new Function`) is refused, and zod falls back to its slower interpreter, which is fine at our scale.
- HSTS can also be turned on in Cloudflare (SSL/TLS → Edge Certificates), which also covers responses that never reach Caddy.
