# Running Dishkept in production

Production is the Compose project **`dishkept`** on this PC, reached at **https://dishkept.geltech.dev** through Cloudflare Tunnel (ADR-0018). It has its own database, photos, secrets and backups, separate from dev.

- Only `pnpm prod:*` commands touch it. Every dev, seed, reset and test command refuses to; `scripts/guard.mjs` checks this.
- Never copy dev's `.env` over `.env.production`, or the other way round.

## First-time setup

OpenTofu creates the cloud resources, and Ansible sets up this PC and deploys (ADR-0021). The commands are in [`infra/README.md`](../infra/README.md). Run them from your development checkout. Ansible makes and keeps the production clone at `~/dishkept` on the Linux disk.
- The stack reads its sync rules and migrations from that clone every time it starts, including after a reboot, so it is always a clean `main`.
- A Windows drive (`/mnt/c`, `/mnt/d`) can't keep `.env.production` private.

The `prod:*` commands refuse to run from a dev checkout (one with a `.env`) or from a Windows drive. Never run `pnpm dev:*` or tests in `~/dishkept`; the guard refuses them.

Do these steps in order. Each ends with a **Check:**; don't go on until it holds.

### 1. What you need first

1. **A Cloudflare account and an API token:** in the Cloudflare dashboard, under My Profile, then API Tokens, create a token with **Zone: Edit**, **DNS: Edit** and **Cloudflare Tunnel: Edit** for your account. Note your account id (the dashboard's sidebar).
2. **A Zoho app password:** at accounts.zoho.com, signed in as the sending mailbox, `noreply@geltech.dev`, go to **Security**, then **App Passwords**, then **Generate New Password**, named `Dishkept`. The SMTP settings are `smtp.zoho.com`, port `465` (SSL), and the login and From address are the same. Backup alerts go to your sign-in address (`OWNER_EMAIL`), not to the sender. Zoho's free plan doesn't include SMTP.
3. **The Claude API key.**
4. **A GitHub fine-grained token:** on this repo only, with **Contents: Read-only** set under Repository permissions (picking the repo alone isn't enough), valid for a year. The VM clones the private repo with it.
5. **A backup bucket name,** for example `dishkept-backups-<something>` (names are global), and a **Vault password**. Put both in your password manager.

**Check:** you have the five items, with the Vault password saved.

### 2. The backup key

```sh
docker run --rm alpine sh -c "apk add -q age && age-keygen"
```

This prints a public key (`age1…`) and a secret key (`AGE-SECRET-KEY-1…`).

- **Put the `AGE-SECRET-KEY-1…` line in your password manager, and print it. Without it, no backup can ever be restored.** Don't store it in the repo, in the Vault file, or anywhere on the server.
- Keep the `age1…` public key for step 5.

When restoring, you'll paste the secret line into a file for a moment. See "Restore".

**Check:** the secret key is in your password manager.

### 3. The cloud resources

Set the credentials (`infra/README.md` §2), then run `infra/bootstrap.sh`, `tofu init`, `tofu plan` and `tofu apply` (§3).

They create:
- the Cloudflare zone for `geltech.dev`, the `dishkept` tunnel, and its hostname `dishkept.geltech.dev` → `http://proxy:8080`;
- the backup bucket, with a 30-day delete rule;
- the `dishkept-backup` service account, which can add and read backups but **cannot delete or overwrite** them. So a compromised PC can't erase old backups.

If `geltech.dev` is already a zone in your Cloudflare account (`tofu plan` would otherwise fail creating it), import it before the plan, from `infra/tofu`: `tofu import cloudflare_zone.site <zone id>`. The zone id is on the zone's overview page. Importing changes nothing at Cloudflare; the next plan should list no change to the zone. The zone's other records (mail, `www`) aren't managed by OpenTofu and stay as they are.

**Check:** `tofu output nameservers` prints two Cloudflare nameservers.

### 4. Point geltech.dev at Cloudflare

If the zone was imported and already says **Active**, skip this step.

At Porkbun:
1. Go to **Domain Management**, then `geltech.dev`, then **Details**, then **Authoritative Nameservers**.
2. Replace Porkbun's nameservers with the two from step 3, and save.

Porkbun stays the registrar; only DNS moves. If the subdomain has URL forwarding at Porkbun, remove it.

**Check:** Cloudflare's overview page for `geltech.dev` says **Active**. This can take from minutes to a few hours.

When you later set up email on geltech.dev, its MX and TXT records go in Cloudflare's DNS page, not Porkbun's.

### 5. The Vault file

Run `pnpm infra:secrets` (`infra/README.md` §4). It:
- generates the database passwords and signing key;
- takes the tunnel token, bucket and service-account key from OpenTofu;
- asks for the rest.

Commit `infra/ansible/group_vars/all/vault.yml` in its own pull request.

**Check:** the file's first line is `$ANSIBLE_VAULT;1.1;AES256`.

### 6. First deploy

Run `ansible-playbook site.yml -l pc --check --diff --ask-vault-pass` (`infra/README.md` §5), read it, then run it without `--check`. It:
- clones `~/dishkept`;
- writes `.env.production` and the GCS key (`0600`);
- runs `pnpm prod:deploy`, which builds and starts the stack, lists your email, and turns the sign-up gate on.

**Check:**
1. The Cloudflare tunnel shows **Healthy**.
2. On your phone, **over mobile data with Wi-Fi off**, open https://dishkept.geltech.dev. It loads.
3. Sign in with your email. The code arrives from the Zoho address.
4. Remove the old home-screen app (the LAN address). In Safari at the new address, choose **Share**, then **Add to Home Screen**.
5. Run the playbook again: it reports `changed=0`.

### 7. First backup and drill

```sh
pnpm prod:backup-now
pnpm prod:restore-test
```

The drill asks for the path to a file holding your secret key. See "Restore" for how to make it and remove it after. The drill checks the counts and one photo file's bytes against the backup. It needs a clean, current `main`, like deploy.

**Check:**
- the drill prints `DRILL PASSED`;
- the bucket shows `dishkept-YYYY-MM-DDTHHMMZ.tar.age`.

**Run the drill again every month.**

### 8. Keep the PC serving

- **Docker Desktop:** in Settings, under General, turn on **Start Docker Desktop when you sign in to your computer**. Ansible warns if it's off.
- **Windows:** in Settings, under System, then Power, set **When plugged in, put my device to sleep after** to **Never**.
- **Windows sign-in:** Docker Desktop starts at *sign-in*, so after a reboot the stack comes back only once you've signed in to Windows.

**Check:** after a reboot and sign-in, `pnpm prod:status` shows every service running, without you doing anything.

## Everyday

| Task | Command |
|---|---|
| Health, deployed build, last backup | `pnpm prod:status` (warns if no backup in 26 hours) |
| Logs | `pnpm prod:logs` or `pnpm prod:logs api` |
| Update to the latest `main` | `cd ~/dishkept && git pull && pnpm prod:deploy` |
| Let someone sign up without an invite | `pnpm prod:allow them@example.com` |
| Remove them from the list | `pnpm prod:disallow them@example.com` |
| See the list | `pnpm prod:allowed` |
| Open or close sign-up for everyone | `pnpm prod:gate off` / `pnpm prod:gate on` |
| Back up now | `pnpm prod:backup-now` |
| Check that alert emails arrive | `pnpm prod:test-alert` (sends "Dishkept alert test" to `BACKUP_ALERT_TO`) |
| Stop production (for example before a long e2e run) | `pnpm prod:stop`; start it again with `pnpm prod:start` (needs a clean, current `main` in `~/dishkept`) |

People with an invite, share or friend link don't need to be on the list. The app gets them a 24-hour pass. People who already have an account can always sign in.

Phones pick up a new build on their own. A phone at the home screen may take it silently the next time the app is closed and reopened.

### Checking the emails after a deploy

Both emails are branded (FR-46), and the logo loads from `https://dishkept.geltech.dev/email-templates/logo.png`.

- **Sign-in code:** sign in on a private window with your own address. The email's subject is "Your Dishkept sign-in code". It shows the logo, the code in a grey card, "This code expires in 10 minutes", and an "Open Dishkept" link.
- **Backup alert:** run `pnpm prod:test-alert`. "Dishkept alert test" arrives with the same header and footer, and "Nothing failed".

If the logo is missing, open its address in a browser. It should load without signing in.

### Sign-in email limits

GoTrue counts sign-in emails for the whole site, not per person (issue #61). If the budget runs out, nobody can get a code until the hour rolls over, and the app says "Could not send a code". Production sets these in `docker-compose.prod.yml`:

| Limit | Production | Setting |
|---|---|---|
| Sign-in emails per hour, whole site | 60 | `AUTH_RATE_LIMIT_EMAIL` |
| Code requests per address, per 5 minutes (after a burst of 30) | 2 | `AUTH_RATE_LIMIT_OTP` |
| Code checks and token refreshes per address, per 5 minutes | 10 | `AUTH_RATE_LIMIT` |
| Emails to one person | 1 a minute | `AUTH_EMAIL_MAX_FREQUENCY` |

One address can make at most 54 code requests in its first hour and 24 an hour after that, so it can't use up the 60 on its own. Many addresses together still can; the Cloudflare rule in issue #72 is the answer to that.

**Zoho's limit must stay above the budget.** Zoho caps how many emails the `noreply@geltech.dev` mailbox may send per hour and per day, and that cap is also shared by the whole site. Check it in the Zoho Mail admin console for your plan. If it's below 60 an hour, or below about 1,500 a day, lower `AUTH_RATE_LIMIT_EMAIL` to match, so GoTrue refuses before Zoho blocks the mailbox. Backup alerts go through the same mailbox.

To change a limit, add its line to the `vault_prod_env: |` block as in [In-app feedback](#in-app-feedback), step 2, then run Ansible as in [Rotating secrets](#rotating-secrets). `pnpm test:prod-config` expects the defaults above, so change it too.

**If nobody can sign in:** `pnpm prod:logs auth | grep over_email_send_rate_limit` shows the budget running out. The count resets within the hour.

### Dependency updates

Dependabot opens pull requests on Mondays (ADR-0024): one grouped PR per ecosystem for minor and patch updates, and one PR for each major update. Nothing reaches production until you deploy.

1. Wait for CI to pass on the PR. A red PR stays open; fix it on its branch or close it.
2. Read the release notes in the PR, especially for GoTrue, PowerSync, cloudflared and Caddy. Look for changed settings, removed flags and data migrations.
3. Merge, then run `cd ~/dishkept && git pull && pnpm prod:deploy`.
4. Run `pnpm prod:status`, and check the changed service in `pnpm prod:logs <service>`. For cloudflared, look for `Registered tunnel connection`.

Never proposed here: a Postgres major (it needs a data upgrade), a Node major, an OpenTofu provider major (it needs code changes and a `tofu plan`), and Expo SDK upgrades (`npx expo install --fix`). Plan each as its own change.

When the "Dependency audit: high or critical advisories" issue is open, a transitive package has an advisory that no bump fixed. Upgrade the parent, or add an entry under `overrides:` in `pnpm-workspace.yaml`. The next Monday's audit closes the issue once the advisory is gone; to check sooner, run the "Dependency audit" workflow by hand in the Actions tab.

CI also runs `pnpm audit --prod --audit-level high` on every PR (ADR-0029), so a new high or critical advisory turns CI red. Fix it the same way. Only if the package is build-time tooling with no fix in its major, add its GHSA id to `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, with a comment saying why. Remove the entry once the parent updates.

Actions are pinned to commit SHAs, and images to `tag@sha256:digest`. Dependabot's PRs update both the pin and the version beside it. When editing a pin by hand, take the digest from `docker buildx imagetools inspect <image:tag>`, and an action's SHA from its release tag.

## Restore

**A restore replaces everything with that night's backup.** Changes made after it are lost, unless a phone still holds them unsynced; those upload afterwards.

1. Put your secret key in a temporary file:
   `(umask 077; cat > /tmp/age.key)`, then paste the `AGE-SECRET-KEY-1…` line, press Enter, then Ctrl-D. Pasting it into `cat` keeps it out of your shell history.
2. Run `pnpm prod:restore` for the newest backup, in the bucket or on this PC, or `pnpm prod:restore 2026-10-19` for that day's newest. A backup not on this PC is fetched from the bucket. If the bucket can't be reached, it says so and chooses from this PC's copies.
3. Enter `/tmp/age.key` when asked. Check the manifest it prints, then type `restore`.
4. When it finishes: `rm /tmp/age.key`.

A wrong key or a damaged file stops the restore **before** anything is replaced.

## Rotating secrets

Every secret is in the Vault file. To change one, run `pnpm infra:secrets --edit`, change the line, and save. Then run `ansible-playbook site.yml -l <host> --ask-vault-pass`, which rewrites `.env.production` and redeploys. Commit the updated Vault file.

`<host>` is wherever production runs: `pc`, or `vm` after a move. **Never run it against a host production has moved away from:** it would start a second copy, with its own database, on the same tunnel.

- **Zoho password:** generate a new app password, then put it in `SMTP_PASS`.
- **Token signing key:** run `pnpm prod:new-signing-key` in `~/dishkept`. It prints a `JWT_KEYS='…'` line; put it in place of the old `JWT_KEYS=` line. People stay signed in: tokens signed with the old key are refused from then on, and each app renews its session with the new key and retries. (`pnpm test:jwt-rotation` tries these steps on a throwaway project.)
- **Backup key:** make a new pair (step 2), set `BACKUP_AGE_RECIPIENT`, run Ansible, then `pnpm prod:backup-now`. **Keep the old secret key for 30 days**, until the last backup made with it has expired.
- **GCS key:**
  1. `tofu apply -replace=google_service_account_key.backup`;
  2. `pnpm infra:secrets --refresh`;
  3. run Ansible;
  4. in `~/dishkept`, `pnpm prod:recreate backup` (a deploy doesn't restart the backup loop for a changed key file);
  5. `pnpm prod:backup-now` to check it uploads.

  OpenTofu has already deleted the old key.
- **Tunnel token:** `tofu apply -replace=random_id.tunnel_secret`, then `pnpm infra:secrets --refresh`, then Ansible.
- **GitHub read token** (yearly, before it expires): make a new one, put it in `vault_github_read_token` with `--edit`, then run Ansible on the VM if there is one.
- **Feedback token** (`GITHUB_FEEDBACK_TOKEN`, before it expires): make a new one as in [In-app feedback](#in-app-feedback), put it in place of the old line with `--edit`, run Ansible, then revoke the old token on GitHub.

## In-app feedback

Ideas and problem reports from the app (FR-45, ADR-0023) are filed as issues in `JHGelpi/recipe-app`. Until a token is set, the app says feedback isn't set up.

1. On GitHub, open **Settings → Developer settings → Fine-grained tokens → Generate new token**.
   - **Resource owner:** you. **Repository access:** only `JHGelpi/recipe-app`.
   - **Permissions:** Issues, read and write. Nothing else.
   - **Expiration:** a year; note the date.
2. Run `pnpm infra:secrets --edit`. In the `vault_prod_env: |` block, add `GITHUB_FEEDBACK_TOKEN=github_pat_…` beside the other env lines, **indented by two spaces like them** and above `vault_gcs_backup_key: |`. A line outside the block, or without the indent, breaks the file's YAML, and Ansible stops with "could not find expected ':'". Then commit the Vault file.
3. Run Ansible as in [Rotating secrets](#rotating-secrets), which rewrites `.env.production` and redeploys.
4. Send a test idea from Household → Send feedback, check it on GitHub, then close it.

Issues are labelled `feature` (ideas) or `bug` (problems); both labels must exist in the repository. Each issue ends with an anonymous reporter id. To see who sent one, look it up as the `postgres` login: `select user_id from public.feedback_reporters where reporter_id = 'r-…'`.

## AI spend limits

AI features (imports and substitutions) stop for the rest of the month at either of two limits (NFR-7). The app then says "Over this month's AI limit".

- **Each household:** `AI_MONTHLY_CAP_USD`, $2 by default.
- **All households together:** `AI_GLOBAL_MONTHLY_CAP_USD`, $10 by default (issue #63). New accounts each get their own household and $2, so without this ceiling the bill would grow with every sign-up.

To change either, add the line to the `vault_prod_env: |` block as in [In-app feedback](#in-app-feedback), step 2, then run Ansible as in [Rotating secrets](#rotating-secrets). Without a line, production uses the default.

**A backstop outside the app:** in the Anthropic Console, open **Settings → Limits** for the workspace that holds the API key, and set a monthly spend limit a little above `AI_GLOBAL_MONTHLY_CAP_USD`, for example $15. If the app's own count ever goes wrong, Anthropic refuses the calls and the app says AI is unavailable.

To see this month's total, run `select public.ai_month_spent_all() / 1e6 as usd` as the `postgres` login.

## Switching the sender to a geltech.dev mailbox

Once the mailbox exists and its DNS records are in Cloudflare:
1. Run `pnpm infra:secrets --edit` and set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` and `BACKUP_ALERT_TO`.
2. Run `ansible-playbook site.yml -l <host> --ask-vault-pass` (`pc`, or `vm` after a move), and commit the Vault file.

Nothing else changes.

## Moving to a VM later

The commands are in `infra/README.md` §2, §5 and §6.

1. `tofu apply -var vm=true`. This creates `dishkept-vm`, with no external IP and SSH through IAP.
2. `ansible-playbook site.yml -l vm -e tunnel=false --ask-vault-pass`. The VM runs the stack, but takes no traffic yet.
3. On the PC, in `~/dishkept`, run `pnpm prod:backup-now`, then `pnpm prod:stop`. The backup holds the last changes, and two connectors with the same tunnel token would split the traffic.
4. On the VM (`gcloud compute ssh dishkept-vm --tunnel-through-iap`), run `cd ~/dishkept && corepack pnpm prod:restore`.
5. `ansible-playbook site.yml -l vm -e force_deploy=true --ask-vault-pass`. Now the tunnel is on.
6. The tunnel follows the token, so no DNS changes.
7. **Retire the PC copy** once the VM has served for a few days. In `~/dishkept` on the PC, run `docker compose -p dishkept down`, so a reboot can't start it again. From then on, every Ansible run uses `-l vm`.

To try the move without changing anything live, run the trial in `infra/README.md` §6. It restores the newest backup on a VM with no tunnel, prints `DRILL PASSED`, and is then destroyed.
