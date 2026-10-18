# 0018. Production on a home PC: tunnel, nightly backups, invite-only sign-up

- **Status:** Accepted
- **Date:** 2026-10-18
- **Amends:** ADR-0008 (how the server is reached; backups)

## Context

ADR-0008 runs the backend as one Compose stack on the owner's hardware, but left two things open: how phones reach it from the internet, and how it is backed up (NFR-8, NFR-9).

The owner chose:
- their own Windows PC (Docker Desktop on WSL) as the server;
- `dishkept.geltech.dev` as the address (`geltech.dev` is registered at Porkbun);
- Zoho for sign-in email, sending for now from an address on another domain;
- Google Cloud Storage for backups;
- an invite-only start, so strangers who find the address cannot spend the owner's Claude credit.

Production starts empty; dev data stays in dev.

## Decision

1. **A second Compose project.**
   - Production is `docker-compose.yml` plus `docker-compose.prod.yml`, run as project `dishkept` with `.env.production`, only through `pnpm prod:*` (`scripts/prod/cli.mjs`).
   - The overlay publishes no host ports and gives Caddy its own data volume. It adds `cloudflared` under the profile `tunnel`.
   - `scripts/guard.mjs` makes every dev, seed, reset and test command refuse when it would reach the `dishkept` project.
2. **Cloudflare Tunnel.**
   - `geltech.dev`'s DNS moves to Cloudflare; Porkbun stays the registrar.
   - A remotely managed tunnel maps `dishkept.geltech.dev` to `http://proxy:8080` inside the stack. `cloudflared` dials out, so the router opens no ports and the home IP stays private. Cloudflare terminates HTTPS.
   - Caddy trusts forwarded headers only from the Docker network.
3. **Nightly backups.**
   - The `backup` service (profile `backup`; Postgres 17 client, `age`, `rclone`, `msmtp`) runs at `BACKUP_TIME` each night:
     - it dumps the `app` database (including GoTrue's `auth` schema) and the `photos` volume, with a manifest of counts;
     - it encrypts all three with `age` to a public key; the private key is held offline by the owner;
     - it uploads the file with `rclone` to a GCS bucket.
   - The bucket deletes objects after 30 days. The service account can create and read objects, but cannot delete or overwrite them.
   - Seven copies stay on the PC. A failure emails the owner.
   - `prod:restore` replaces the database and photos. `prod:restore-test` restores into a throwaway `dishkept-drill` project without the tunnel and compares counts; the owner runs it monthly.
   - `test:backup` runs the same scripts in CI with a local folder in place of GCS.
4. **Sign-up gate.**
   - GoTrue's `before_user_created` hook calls `public.before_user_created_hook`. With `signup_settings.gate_on`, it admits only emails on `signup_allowed` or holding a live 24-hour pass in `signup_passes`.
   - Passes come from `POST /api/signup-pass` through the security definer `grant_signup_pass`, which accepts only live invite, share and friend links. The route is rate limited per email and per link.
   - "Invite a friend" shares a 30-day `/welcome/<code>` link (`friend_links`).
   - The three signup tables have RLS on with no policies or grants, and are not synced.
   - Existing accounts always sign in. The gate is off by default (dev and tests); the first `prod:deploy` turns it on and lists `OWNER_EMAIL`.

## Alternatives considered

- **Tailscale:** nothing exposed at all, but shared links and invites would only work for people on the owner's tailnet.
- **Router port forward with Let's Encrypt:** no Cloudflare account, but it exposes the home IP and the PC, and needs dynamic DNS.
- **Cloudflare R2 or Backblaze B2:** both free at this size; the owner already has a GCP account.
- **Point-in-time recovery (WAL-G or pgBackRest):** loses minutes rather than up to a day, but has more moving parts to run and test. Phones also keep unsynced changes, which narrows the real loss.
- **The allowed list in `.env`:** needs a restart per change, and the Postgres hook can't read it.
- **Open sign-up with a global AI cap:** simpler, but strangers could still fill the database and use the shared budget.

## Consequences

- Production runs from its own clone on the Linux disk (`~/dishkept`). The stack rereads sync rules and migrations from the checkout on every start, so the dev checkout must never be the one it runs from. `prod:*` refuses a checkout that has a dev `.env` or sits on a Windows drive, and `start`, `deploy` and `restore` require a clean, current `main`.
- The app is down whenever the PC is off, asleep or rebooting (NFR-8 is now best effort). Moving to a VM means a restore plus running the tunnel connector there.
- **Losing the `age` private key makes every backup unreadable.**
- A restore loses changes made after that night's backup, unless a phone still holds them unsynced.
- A drill must never start `cloudflared`: a second connector with the same token would serve the drill publicly. `DRILL_PROFILES` leaves out `tunnel`, and `test:prod-config` checks this in CI.
- Gate tests flip shared state and must switch the gate off in `finally`/`afterEach`. The suites run serially.
- The `backup` service connects as `postgres`, an operations path like `prod:allow`. The API still uses only `api_login` (CLAUDE.md rule 1).
- New dependencies: `cloudflare/cloudflared`, `age`, `rclone`, `msmtp`.
