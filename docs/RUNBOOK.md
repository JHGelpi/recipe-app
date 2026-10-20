# Running Dishkept in production

Production is the Compose project **`dishkept`** on this PC, reached at **https://dishkept.geltech.dev** through Cloudflare Tunnel (ADR-0018). It has its own database, photos, secrets and backups, separate from dev.

- Only `pnpm prod:*` commands touch it. Every dev, seed, reset and test command refuses to; `scripts/guard.mjs` checks this.
- Never copy dev's `.env` over `.env.production`, or the other way round.

## First-time setup

### 0. A separate clone for production

Production runs from **its own clone of the repo on the Linux disk**, never from the checkout you develop in.
- The stack reads its sync rules and migrations from the checkout every time it starts, including after a reboot. A feature branch must never be what production starts from.
- A Windows drive (`/mnt/c`, `/mnt/d`) can't keep `.env.production` private.

The `prod:*` commands refuse to run from a dev checkout (one with a `.env`) or from a Windows drive.

```sh
git clone https://github.com/JHGelpi/recipe-app.git ~/dishkept
cd ~/dishkept
corepack pnpm install
```

Run every command below from `~/dishkept`, and never run `pnpm dev:*` or tests there; the guard refuses them.

**Check:** `pwd` shows `/home/<you>/dishkept`, and `ls .env` says there is no such file.


Do these steps in order. Each ends with a **Check:**; don't go on until it holds.

### 1. Move geltech.dev's DNS to Cloudflare

1. Sign in at dash.cloudflare.com. Choose **Add a domain**, enter `geltech.dev`, and pick the **Free** plan.
2. Cloudflare shows two nameservers (like `xxx.ns.cloudflare.com`).
3. At Porkbun: **Domain Management**, then `geltech.dev`, then **Details**, then **Authoritative Nameservers**. Replace Porkbun's nameservers with Cloudflare's two and save. Porkbun stays the registrar; only DNS moves.

**Check:** Cloudflare's overview page for `geltech.dev` says **Active**. This can take from minutes to a few hours.

When you later set up email on geltech.dev, its MX and TXT records go in Cloudflare's DNS page, not Porkbun's.

### 2. Create the tunnel

1. In Cloudflare: **Zero Trust**, then **Networks**, then **Tunnels**, then **Create a tunnel**. Choose **Cloudflared** and name it `dishkept`.
2. On the install page, copy the **token**: the long string after `--token`. Ignore the install commands; the stack runs `cloudflared` itself.
3. **Public Hostnames**, then **Add a public hostname**:
   - subdomain `dishkept`, domain `geltech.dev`;
   - service type `HTTP`, URL `proxy:8080`.
4. Save.

**Check:** the tunnel is listed. It shows **Healthy** after step 7.

### 3. Zoho app password

1. At accounts.zoho.com, signed in as `wes@data2insightsllc.com`: **Security**, then **App Passwords**, then **Generate New Password**, named `Dishkept`. Copy it.
2. The SMTP settings are `smtp.zoho.com`, port `465` (SSL). Zoho only allows sending from the address you log in with, so the login and From address are the same. Port `587` also works: the alert then uses STARTTLS.

Zoho's free plan doesn't include SMTP. If step 7's test code never arrives, check the plan first.

**Check:** step 7.

### 4. Google Cloud Storage bucket

Run these in **Cloud Shell** (the `>_` button at console.cloud.google.com), in your project. Choose a bucket name, for example `dishkept-backups-<something>` (names are global).

```sh
PROJECT=$(gcloud config get-value project)
BUCKET=dishkept-backups-<something>
gcloud storage buckets create gs://$BUCKET --location=us-east1 \
  --uniform-bucket-level-access --public-access-prevention
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > lifecycle.json
gcloud storage buckets update gs://$BUCKET --lifecycle-file=lifecycle.json
gcloud iam service-accounts create dishkept-backup --display-name="Dishkept backup"
SA=dishkept-backup@$PROJECT.iam.gserviceaccount.com
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:$SA --role=roles/storage.objectCreator
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:$SA --role=roles/storage.objectViewer
gcloud iam service-accounts keys create gcs-backup-key.json --iam-account=$SA
```

Then:
1. In Cloud Shell's **⋮** menu, choose **Download** and save `gcs-backup-key.json`.
2. Put it in the production clone at `~/dishkept/.local/gcs-backup-key.json` (`mkdir -p ~/dishkept/.local` first). The file is git-ignored.
3. Delete the copy in Cloud Shell: `rm gcs-backup-key.json`.

The service account can add and read backups but **cannot delete or overwrite** them, so a compromised PC can't erase old backups. The lifecycle rule removes them after 30 days.

**Check:** `ls -l .local/gcs-backup-key.json` shows the file.

### 5. The backup key

```sh
docker run --rm alpine sh -c "apk add -q age && age-keygen"
```

This prints a public key (`age1…`) and a secret key (`AGE-SECRET-KEY-1…`).

- **Put the `AGE-SECRET-KEY-1…` line in your password manager, and print it. Without it, no backup can ever be restored.** Don't store it in the repo or anywhere on the server.
- Keep the `age1…` public key for step 6.

When restoring, you'll paste the secret line into a file for a moment. See "Restore".

**Check:** the secret key is in your password manager.

### 6. Write `.env.production`

```sh
pnpm prod:init
```

It generates fresh database passwords and a signing key, then asks for:
- the tunnel token;
- the Zoho login, app password and From address (the same as the login);
- the Claude API key;
- the bucket name;
- the `age1…` public key;
- your sign-in email.

**Check:** in `~/dishkept`, `ls -l .env.production` shows `-rw-------`.

### 7. First deploy

```sh
cd ~/dishkept && git pull
pnpm prod:deploy
```

It builds and starts the stack, then lists your email and turns the sign-up gate on. It ends with `prod:status`.

**Check:**
1. The Cloudflare tunnel shows **Healthy**.
2. On your phone, **over mobile data with Wi-Fi off**, open https://dishkept.geltech.dev. It loads.
3. Sign in with your email. The code arrives from the Zoho address.
4. Remove the old home-screen app (the LAN address). In Safari at the new address, choose **Share**, then **Add to Home Screen**.

### 8. First backup and drill

```sh
pnpm prod:backup-now
pnpm prod:restore-test
```

The drill asks for the path to a file holding your secret key. See "Restore" for how to make it and remove it after.

**Check:**
- the drill prints `DRILL PASSED`;
- the bucket shows `dishkept-YYYY-MM-DDTHHMMZ.tar.age`.

**Run the drill again every month.**

### 9. Keep the PC serving

- **Docker Desktop:** in Settings, under General, turn on **Start Docker Desktop when you sign in to your computer**.
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

## Restore

**A restore replaces everything with that night's backup.** Changes made after it are lost, unless a phone still holds them unsynced; those upload afterwards.

1. Put your secret key in a temporary file:
   `(umask 077; cat > /tmp/age.key)`, then paste the `AGE-SECRET-KEY-1…` line, press Enter, then Ctrl-D. Pasting it into `cat` keeps it out of your shell history.
2. Run `pnpm prod:restore` for the latest backup, or `pnpm prod:restore 2026-10-19` for a given day. A day not on this PC is fetched from the bucket.
3. Enter `/tmp/age.key` when asked. Check the manifest it prints, then type `restore`.
4. When it finishes: `rm /tmp/age.key`.

A wrong key or a damaged file stops the restore **before** anything is replaced.

## Rotating secrets

- **Zoho password:** generate a new app password, put it in `SMTP_PASS` in `.env.production`, then `pnpm prod:deploy`.
- **Token signing key:** replace `JWT_KEYS`; generate a new one with `pnpm env:init` in an empty folder and copy the line. Then `pnpm prod:deploy`. Everyone signs in again.
- **Backup key:** make a new pair (step 5), set `BACKUP_AGE_RECIPIENT`, `pnpm prod:deploy`, then `pnpm prod:backup-now`. **Keep the old secret key for 30 days**, until the last backup made with it has expired.
- **GCS key:** `gcloud iam service-accounts keys create` a new key, replace `.local/gcs-backup-key.json`, `pnpm prod:deploy`, then delete the old key in the Cloud Console.

## Switching the sender to a geltech.dev mailbox

Once the mailbox exists and its DNS records are in Cloudflare:
1. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` and `BACKUP_ALERT_TO` in `.env.production`.
2. Run `pnpm prod:deploy`.

Nothing else changes.

## Moving to a VM later

1. Install Docker on the VM and clone the repo.
2. Copy `.env.production` and `.local/gcs-backup-key.json` across.
3. `pnpm prod:stop` on the PC. Two connectors with the same tunnel token would split the traffic.
4. On the VM, run `pnpm prod:deploy`, then `pnpm prod:restore`.
5. The tunnel follows the token, so no DNS changes.
