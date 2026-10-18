# Running Dishkept for real: design

Date: 2026-10-18 · Status: approved in conversation, awaiting written review

## 1. Goal

Run Dishkept as a production service at **https://dishkept.geltech.dev**, on the owner's own PC, apart from development. Back it up every night, off-site, with a restore that has been tested. Covers NFR-8 and NFR-9, and closes ADR-0008's open point on how the server is reached.

Success means:
- the owner's phone uses the app at `dishkept.geltech.dev` from anywhere, over HTTPS, with no router ports opened;
- nothing in development or testing can reach the production database: not `db:reset`, not any `test:*` command, not the dev stack;
- every night an encrypted backup of the database and photos lands in Google Cloud Storage, and a failed or missing backup reaches the owner by email;
- `pnpm prod:restore-test` shows that the latest backup restores into a working stack;
- strangers who find the address cannot create accounts, and so cannot spend the owner's AI credit.

### Decisions made with the owner
- **Server:** the owner's Windows PC (Docker Desktop on WSL), as a second stack next to dev. Moving to another box or a cloud VM later is a restore plus a tunnel change.
- **Address:** `dishkept.geltech.dev`. `geltech.dev` is registered at Porkbun; its DNS moves to Cloudflare (free plan). Porkbun stays the registrar.
- **Reached through Cloudflare Tunnel.** No router ports, home IP hidden, HTTPS handled by Cloudflare.
- **Email:** Zoho SMTP, sending from `wes@data2insightsllc.com` for now. The sender address and name are settings, because a geltech.dev mailbox will replace it.
- **Backups:** Google Cloud Storage, nightly, kept 30 days. No point-in-time recovery (NFR-9 is reworded).
- **Data:** production starts empty. Dev recipes stay in dev.
- **Sign-ups:** only addresses on an allowed list, plus people arriving through an invite, friend or shared recipe link.

### Out of scope
- Monitoring beyond backup emails and `prod:status`.
- An email address on geltech.dev.
- Copying dev data into production.
- Point-in-time recovery.
- A cloud VM; the runbook only describes the move.

## 2. The production stack

### Same file, separate project
- Production is `docker-compose.yml` plus a small overlay, **`docker-compose.prod.yml`**, run as Compose project **`dishkept`** with **`.env.production`**. Dev stays project `recipe-app` with `.env` and the `dev` profile (Mailpit).
- The overlay only:
  - removes every host port mapping (`ports: !reset []` on `db` and `proxy`);
  - adds the `cloudflared` and `backup` services (§5).
  
  Every other line is the shared file, so production runs what the tests run.
- Compose prefixes volumes and networks with the project name, so production has its own `dishkept_db`, `dishkept_photos` and network.
- **No host ports in production.** Nothing is published on the PC, and production doesn't clash with dev's ports. Maintenance uses `docker compose -p dishkept exec`.
- Every service keeps `restart: unless-stopped`.

### Guard
- A small script, `scripts/guard.mjs`, runs first in `db:reset`, `db:seed`, `dev:backend`, `dev:backend:test`, `dev:backend:stop` and every `test:*` command. It refuses, with a message naming the project, when any of these hold:
  - `COMPOSE_PROJECT_NAME` is `dishkept`;
  - `COMPOSE_FILE` or `--env-file` points at `.env.production`;
  - `.env` contains `APP_ENV=production`.
- `.env.production` holds `APP_ENV=production` and `COMPOSE_PROJECT_NAME=dishkept`. The `prod:*` scripts always pass `-p dishkept --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml` explicitly, and never read `.env`.
- The test-mode overlay (`docker-compose.test.yml`) is never applied to `dishkept`, and the `prod:*` scripts refuse if `COMPOSE_FILE` is set.

### Tunnel
- In the Cloudflare dashboard the owner creates a remotely managed tunnel and a public hostname, `dishkept.geltech.dev` → `http://proxy:8080`. Its token goes in `.env.production` as `TUNNEL_TOKEN`.
- The `cloudflared` service (`cloudflare/cloudflared`, pinned) runs `tunnel run` with that token. It dials out, so nothing on the router changes.
- The tunnel reaches Caddy's existing plain-HTTP listener, port 8080 inside the network. Caddy trusts `X-Forwarded-*` only from the Docker network, so GoTrue and the API see `https`.
- `PUBLIC_URL=https://dishkept.geltech.dev`. The built web app still uses relative paths only (ADR-0008); no host name goes into an image.
- At home the phone also uses the public address. The LAN certificate setup (`LAN_HTTPS_HOST`) stays a dev feature.

### Deploying
- `pnpm prod:init` writes `.env.production` once:
  - fresh database passwords and the JWT signing key, as `env:init` does for dev;
  - prompts for `TUNNEL_TOKEN`, the SMTP settings, `ANTHROPIC_API_KEY`, the backup bucket and the `age` public key.
  - It refuses to overwrite an existing file.
- `pnpm prod:deploy`:
  1. refuses unless the working tree is clean and `HEAD` equals `origin/main` after a fetch;
  2. builds the images and runs `up -d --build --wait --remove-orphans` for project `dishkept` (migrations run through the `migrate` service as today);
  3. restarts `sync` so it rereads its config;
  4. prints the build time the app reports.
- `pnpm prod:status` prints:
  - each service's health;
  - the deployed build time;
  - the last successful backup time, with a warning when it is older than 26 hours.
- `pnpm prod:logs [service]` and `pnpm prod:stop` wrap the matching Compose commands.

### Staying up (NFR-8)
- The runbook sets Docker Desktop to start at login and Windows never to sleep while plugged in.
- The app is down whenever the PC is off or rebooting. NFR-8 becomes: "Best effort on a home PC; move to a VM when uptime matters."
- Memory: production is small, but dev plus production plus a full e2e run is tight in 8 GB. The runbook says to stop production with `prod:stop` before long e2e runs if the machine struggles.

## 3. Email

- `.env.production`:
  - `SMTP_HOST=smtp.zoho.com`, `SMTP_PORT=465`;
  - `SMTP_USER=wes@data2insightsllc.com` and `SMTP_PASS` (a Zoho app-specific password);
  - `SMTP_FROM=wes@data2insightsllc.com`;
  - `SMTP_SENDER_NAME=Dishkept`.
- `GOTRUE_SMTP_SENDER_NAME` reads `SMTP_SENDER_NAME` (default `Dishkept`), so dev is unchanged.
- Zoho only sends "from" the account that logs in, so `SMTP_USER` and `SMTP_FROM` must match. The free Zoho plan has no SMTP; the runbook's test-send step catches that.
- Switching to a geltech.dev mailbox later changes these values and restarts `auth`. Nothing else changes.
- Production rate limits: `AUTH_RATE_LIMIT=10` and `AUTH_EMAIL_MAX_FREQUENCY=60s`.

## 4. Who can sign up

### The gate
- GoTrue 2.197 calls a Postgres function before it creates any user (`before_user_created` hook, `pg-functions`).
- `public.before_user_created_hook(event jsonb)` lets the sign-up through when any of these hold:
  - the gate is open: `signup_settings.gate_on` is false, which is the default, used in dev and most tests;
  - the email is on the allowed list, `signup_allowed`;
  - the email has an unexpired **pass** in `signup_passes`.
- Otherwise the hook returns an error with HTTP status 403 and the message key `invite_only`. Checking compares the lowercased, trimmed email.
- Existing accounts never pass through this hook, so they always sign in.
- The sign-in screen shows: **"Dishkept is invite-only for now. Ask someone who uses it to send you an invite."**

### The allowed list
- `pnpm prod:allow <email>`, `pnpm prod:disallow <email>` and `pnpm prod:allowed` run `psql` in the `dishkept` db container as `postgres`. Changes apply at once.
- `pnpm prod:gate on|off` sets `gate_on`. `prod:init` turns it on and adds the owner's address.

### Passes from links
- `POST /api/signup-pass` with `{ kind: 'invite' | 'share' | 'friend', code, email }`, signed out, through `asAnonymous`, calls the security definer function `public.grant_signup_pass(kind, code, email)`:
  - checks that the code names a live invite, share or friend link;
  - inserts or refreshes a pass for that email, expiring after 24 hours;
  - returns nothing that reveals whether the email already has an account.
  - An invalid or expired code raises the same `invite_only` key.
  - Rate limited per address and per code, like the other signed-out routes.
- **The app asks for the pass first** on every signed-out flow that can create an account:
  - the invite page `/invite/<code>`;
  - the shared page's "Save to my recipes";
  - the new friend page `/welcome/<code>`.
  - When the pass call fails offline, the flow keeps today's "needs a connection" message.

### Friend links
- "Invite a friend to Dishkept" in Household now shares `https://dishkept.geltech.dev/welcome/<code>`, not the bare address. The link works for 30 days.
- New table `public.friend_links`:
  - columns `id`, `household_id`, `token_hash`, `expires_at`, plus the standard `created_at`, `updated_at`, `updated_by` and `deleted_at`;
  - RLS on: Admins and Members of the household may select it;
  - created only through `public.create_friend_link()`, which returns the code. Viewers may create one too, since it adds nothing to the household.
- `/welcome/<code>` shows the Dishkept mark, "Someone invited you to make your own recipe collection", and the sign-in card. A dead code shows "This link has expired" and still offers sign-in for existing accounts.

### Storage and isolation
- `signup_settings`, `signup_allowed` and `signup_passes`:
  - hold only emails, times and the gate flag;
  - have RLS enabled with **no policies** and no grants to `authenticated` or `anon`;
  - are reached only by the hook function (granted to `supabase_auth_admin`), `grant_signup_pass`, and `postgres` from the `prod:*` scripts.
- None of these tables, nor `friend_links`, are added to the sync config.
- All four tables are added to `apps/api/tests/rls/registry.ts`; the three signup tables are marked as system tables with no household column.
- Expired passes are deleted by `grant_signup_pass` itself each time it runs, and by the nightly backup before the dump (§5).
- The 30-day trash purge stays as it is: the app calls it for its own household (FR-18).

## 5. Backups and restore (NFR-9)

### What a backup holds
- `app.dump`: `pg_dump --format=custom` of the `app` database. It includes GoTrue's `auth` schema, so accounts are covered.
- `photos.tar`: the `photos` volume.
- `manifest.json`: date, build time, latest migration version, and row counts for `auth.users`, `households`, `memberships`, `recipes`, `photos`, `shares`.
- PowerSync's storage database is not backed up; the sync service rebuilds it from `app`.
- The three parts are packed into one tar and encrypted with `age` to `BACKUP_AGE_RECIPIENT`: `dishkept-YYYY-MM-DD.tar.age`.

### The `backup` service
- Built from `deploy/backup.Dockerfile`: Postgres 17 client tools, `age`, `rclone` and `msmtp`, with `scripts/backup/*.sh`.
- It connects as `postgres`, which `pg_dump` needs to read every schema. This is an operations path, like `prod:allow`. No app code path uses it, and the API keeps `api_login` only (CLAUDE.md rule 1).
- It mounts the `photos` volume read-only, a `backups` volume for local copies, and the GCS key file read-only.
- It runs once a day at `BACKUP_TIME` (default `03:30`) in `TZ` (default `America/New_York`), using a sleep loop rather than cron. `docker compose -p dishkept run --rm backup now` runs one immediately.
- Steps:
  1. delete expired signup passes;
  2. dump, pack and encrypt;
  3. upload with `rclone` to `gcs:${BACKUP_BUCKET}/`;
  4. keep the newest 7 files in the `backups` volume;
  5. write `last-success` with the time.
- **On any failure** it emails `BACKUP_ALERT_TO` (default `SMTP_FROM`) through the same SMTP settings, with the failing step and the last log lines.
- `prod:status` reads `last-success`.

### Google Cloud Storage
The runbook gives the exact `gcloud` commands for:
- one private bucket with uniform access and a lifecycle rule that deletes objects older than 30 days;
- a service account with **Storage Object Creator and Storage Object Viewer on that bucket only**. It cannot delete or overwrite objects, so a compromised PC cannot erase old backups;
- its JSON key at `.local/gcs-backup-key.json` (git-ignored).

### The key
- `prod:init` tells the owner to run `age-keygen`. The **private key goes into the owner's password manager**, with a printed copy recommended, and is never stored in the repo or on the server. Only the public key goes in `.env.production`.
- Without the private key no backup can be restored. The runbook says so in bold.

### Restoring
- `pnpm prod:restore [YYYY-MM-DD]`:
  1. takes the latest backup, or the named date, from the local copies or GCS;
  2. asks for the path to the private key and decrypts;
  3. shows the manifest and makes the owner type `restore`;
  4. stops `api`, `auth`, `sync` and `proxy`;
  5. drops and recreates the `app` database and restores the dump as `postgres`, and replaces the photos volume's contents;
  6. starts the stack, which brings migrations up to date, and restarts `sync` so it rebuilds.
- Phones then sync to the restored state. Changes saved after that backup are lost unless a phone still holds them unsynced, in which case they upload. The runbook warns about this.

### Restore drill
- `pnpm prod:restore-test` restores the latest backup into a throwaway project, `dishkept-drill`, with its own volumes and no tunnel.
- It waits for health, compares the row counts with the manifest, checks that one recipe photo can be read, prints a pass or fail, and removes the drill project and its volumes.
- It needs the private key, so it is manual. The runbook says to run it after the first backup and then monthly.

## 6. Testing

- **Unit:**
  - the guard: each production signal refuses, and plain dev passes;
  - `prod:deploy` preconditions: a dirty tree, being behind `origin/main` and being on another branch each refuse;
  - the backup file name and which 7 local copies are kept;
  - the stale-backup check: under and over 26 hours.
- **RLS suite:**
  - the hook allows a listed email and an email with a live pass;
  - it rejects an expired pass, an unknown email with the gate on, and compares emails ignoring case and spaces;
  - `grant_signup_pass` accepts only live invite, share and friend codes;
  - `authenticated` and `anon` cannot read or write the signup tables;
  - `friend_links` follows the household rules, and other households can't see it.
- **Stack:** with the gate on, `signInWithOtp` for an unknown email returns the `invite_only` refusal; the same email succeeds after a pass.
- **API:** `POST /api/signup-pass` refuses a bad code with the same answer as an unknown one, and is rate limited.
- **End to end** (the gate switched on for these tests only, and off after):
  - a stranger sees the invite-only message;
  - a new person signs up through an invite link, through a shared recipe's Save, and through a friend link;
  - an existing account signs in normally;
  - Household's "Invite a friend" shares a `/welcome/` link.
- **Backup round trip** (`pnpm test:backup`, in CI):
  - runs the backup scripts against the test stack, with a throwaway `age` key and an `rclone` local folder in place of GCS;
  - restores into a drill project and compares the counts;
  - restoring with the wrong key fails clearly.
- The existing suites pass unchanged.

## 7. Docs

- **ADR-0018:**
  - production on the home PC through Cloudflare Tunnel;
  - nightly `age`-encrypted backups to GCS with a no-delete service account;
  - the sign-up gate.
  - It closes ADR-0008's "how the server is reached" and backup consequences.
  - New dependencies: `cloudflared`, `age`, `rclone`, `msmtp`.
- **ARCHITECTURE:**
  - the `cloudflared` and `backup` containers;
  - the environments paragraph (production is now real);
  - the Database row and the backups row.
- **SPEC:**
  - NFR-8 and NFR-9 reworded as above;
  - FR-1 gains "sign-up is limited to allowed addresses and invited people";
  - §7 question 4 (working app name) is closed as Dishkept.
- **CLAUDE.md:**
  - the `prod:*` commands;
  - a rule: never run test, seed or reset commands against production; the guard enforces it.
- **`docs/RUNBOOK.md`** gives the owner's steps in order, each with a check that it worked:
  1. Cloudflare: add `geltech.dev`, then set its nameservers at Porkbun.
  2. Create the tunnel and the `dishkept.geltech.dev` hostname.
  3. Zoho: create an app-specific password.
  4. Google Cloud: create the bucket, the lifecycle rule and the service account, and download its key.
  5. `age-keygen`; store the private key.
  6. `pnpm prod:init`.
  7. `pnpm prod:deploy`. Send a test sign-in code; sign in on the phone at the new address; remove the old home-screen app and add the new one.
  8. Run a backup now, then `pnpm prod:restore-test`.
  9. Windows: Docker Desktop at login; no sleep while plugged in.

  It also covers updating, restoring, rotating the JWT key, SMTP password and backup key, and moving to a VM.
