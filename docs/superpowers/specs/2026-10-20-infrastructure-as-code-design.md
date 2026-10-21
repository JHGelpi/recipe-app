# Infrastructure as code: design

Date: 2026-10-20 · Status: approved in conversation, awaiting written review

## 1. Goal

Replace the RUNBOOK's click-through and Cloud Shell setup with code: **OpenTofu** for cloud resources, and **Ansible** for the machine production runs on. The same code must stand up production on the owner's PC today, and on a cloud VM later, without a rewrite (ADR-0018's "Moving to a VM later").

Success means:
- from an empty Cloudflare and GCP account, a handful of commands (plus one manual nameserver change at Porkbun) bring production up on the PC, at https://dishkept.geltech.dev;
- the same playbook brings it up on a GCP VM, proven by a real trial: create the VM, restore the PC's backup there, `DRILL PASSED`, destroy the VM;
- secrets survive losing the PC: they're kept encrypted in the (private) repo, unlocked by one password in the owner's password manager;
- re-running anything with nothing new reports no changes;
- the `prod:*` scripts stay the one way production is operated. Ansible calls them, and doesn't copy their logic.

### Decisions made with the owner
- **Targets:** both the PC and a VM, as a setting (option 3).
- **VM provider:** GCP, where the account and backups already are. The trial is real: a small VM is created, tested and destroyed.
- **Secrets:** an Ansible Vault file in the repo (option 1). The backup's `age` secret key stays out of it, as today, kept only in the password manager.
- **Starting point:** none of the cloud steps are done, so everything is created fresh, with nothing to import.
- **Approach A:** OpenTofu for the cloud, Ansible for the hosts.

### Out of scope
- Automatic deploys from CI.
- Monitoring beyond today's backup alerts.
- A staging environment.
- Scripting the Porkbun nameserver change, or Windows' power and sign-in settings.
- Changes to the app or to the Compose files.

## 2. Layout

```
infra/
  bootstrap.sh    one-time: the state bucket, with gcloud
  tofu/           all cloud resources; state in the state bucket
    main.tf         providers, backend, variables
    cloudflare.tf   zone, tunnel, its hostname rule, DNS record
    backups.tf      backup bucket, service account, its key
    vm.tf           only when var.vm is true
    outputs.tf
  ansible/
    inventory.yml
    group_vars/all/vars.yml     non-secret settings
    group_vars/all/vault.yml    encrypted (ansible-vault)
    roles/{docker,node,app,deploy,serve}/
    site.yml        the whole setup for one host
    trial.yml       the VM drill
  README.md
scripts/infra/      the infra:* commands (Node, like scripts/prod)
```

## 3. OpenTofu

### Credentials
- **GCP:** the owner's `gcloud auth application-default login`.
- **Cloudflare:** an API token the owner creates once, with Zone:Edit, DNS:Edit and Cloudflare Tunnel:Edit on their account. It's passed as `CLOUDFLARE_API_TOKEN`, along with `TF_VAR_cloudflare_account_id`.
- Neither credential is stored in the repo or in state.

### State
- `infra/bootstrap.sh` creates `gs://<project>-dishkept-tofu-state` in `us-east1`. It's uniform access, public access prevented, versioned, and readable only by the owner's account (no extra IAM). The script is idempotent: it does nothing if the bucket exists.
- `main.tf` uses the `gcs` backend with that bucket and the prefix `dishkept`.
- State holds the tunnel token and the service-account key. That is why the bucket stays private and versioned, and why hosts never read state.

### Resources (`cloudflare.tf`, `backups.tf`)
- **The zone:** `geltech.dev` on the Free plan. The output `nameservers` is the pair to paste at Porkbun.
- **The tunnel:** `dishkept`, remotely managed, with one ingress rule, `dishkept.geltech.dev` → `http://proxy:8080`, and a final `http_status:404`. A proxied `CNAME dishkept` points to `<tunnel id>.cfargotunnel.com`. The output `tunnel_token` is sensitive.
- **The backup bucket:** `var.backup_bucket` (globally unique, chosen by the owner) in `us-east1`, with uniform access, public access prevented, and a lifecycle rule that deletes after 30 days.
- **The service account** `dishkept-backup` has `roles/storage.objectCreator` and `roles/storage.objectViewer` on that bucket only. It can't delete or overwrite, as the RUNBOOK requires. Its key is a `google_service_account_key`, with the output `backup_key_json` (sensitive).
- **Region:** `us-east1` throughout.

### The VM (`vm.tf`, only when `var.vm = true`)
- **The machine:** `dishkept-vm`, `e2-micro` by default (the free tier: 1 GB, with a 2 GB swap file from Ansible's `swap` role), Debian 12, a 30 GB standard disk, and no external IP. `-var machine_type=e2-small` gives it 2 GB if the micro proves too small.
- **Network:** a `dishkept` network and subnet, with a Cloud Router and Cloud NAT for outbound. The tunnel dials out, and images and packages are pulled.
- **Firewall:** inbound allows only TCP 22 from IAP's range, `35.235.240.0/20`.
- **SSH:** the owner's account uses OS Login (`roles/compute.osAdminLogin`, granted on the project to the applying user).
- **Outputs:** `vm_name` and `vm_zone`, or empty when there's no VM.
- `tofu apply -var vm=false` removes the VM, NAT and network. The NAT exists only while the VM does.

## 4. Ansible

### Inventory (`inventory.yml`)
- **`pc`:** `ansible_connection: local`, with `app_dir: ~/dishkept`. It refuses to run if `app_dir` is on `/mnt/*`, which repeats the `prod:*` guard.
- **`vm`:**
  - `ansible_host: dishkept-vm`, reached over SSH with `ProxyCommand gcloud compute start-iap-tunnel %h 22 --listen-on-stdin --zone <zone>`;
  - the user is the owner's OS Login name;
  - the zone comes from `group_vars` and must match `vm_zone`.
- A run always names its host: `-l pc` or `-l vm`. Playbooks fail when run against both hosts at once.

### The Vault file (`group_vars/all/vault.yml`)
- It holds two variables, `vault_prod_env` (the whole `.env.production` text) and `vault_gcs_backup_key` (the JSON).
- It's encrypted with `ansible-vault`. The password is read from `ANSIBLE_VAULT_PASSWORD_FILE` or asked for, and never stored in the repo.
- It's committed. The repo is private, and the encryption is the main protection.

### `pnpm infra:secrets` (`scripts/infra/secrets.mjs`)
- **With no Vault file:**
  - it generates the database passwords and `JWT_KEYS` with the same functions `prod:init` uses (moved into `scripts/prod/lib.mjs` if needed, not copied);
  - it asks for `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ANTHROPIC_API_KEY`, `BACKUP_AGE_RECIPIENT` and `OWNER_EMAIL`;
  - it takes `TUNNEL_TOKEN`, `BACKUP_BUCKET` and the key JSON from `tofu output -json`;
  - it builds the env text from `.env.production.example`, as `prod:init` does, and encrypts it with `ansible-vault encrypt` reading stdin.
- **`--edit`** runs `ansible-vault edit`, for rotations.
- **`--refresh`** decrypts to memory, replaces `TUNNEL_TOKEN`, `BACKUP_BUCKET` and the key from the current outputs, and re-encrypts.
- Plaintext never touches disk: it goes through pipes only, and no temp files are written.

### Roles
1. **`docker`** (VM only): Docker Engine and the Compose plugin from Docker's apt repository, enabled at boot, with the user in the `docker` group.
2. **`node`** (VM only): Node 22 from NodeSource, and `corepack enable` for pnpm. The PC keeps its own Node.
3. **`app`** (both):
   - `git` clone, or fast-forward `app_dir` to `origin/main`. It fails if the checkout has local changes or isn't on `main`, which the `prod:*` scripts require anyway;
   - `corepack pnpm install --frozen-lockfile`;
   - it writes `.env.production` and `.local/gcs-backup-key.json` (mode `0600`, `no_log: true`) from the Vault file.
4. **`deploy`** (both):
   - it runs `corepack pnpm prod:deploy`, plus `--no-tunnel` when `tunnel: false`;
   - it runs only when the `app` role changed something (a handler), or with `-e force_deploy=true`.
5. **`serve`:**
   - **The VM:** none needed. Docker starts at boot, and the services have `restart: unless-stopped`.
   - **The PC:** it reads Docker Desktop's `settings-store.json` and warns if "start at sign-in" (`AutoStart`) is off. The sleep setting stays a RUNBOOK step.

### Playbooks
- **`site.yml`:** all five roles for the named host. The variable `tunnel` defaults to `true`.
- **`trial.yml`** (VM only):
  1. runs `site.yml`'s roles with `tunnel: false`;
  2. asks for the `age` secret key with a hidden `vars_prompt`, and writes it to `/tmp/dishkept-age.key` (`0600`, `no_log`);
  3. runs `corepack pnpm prod:restore-test --key-file /tmp/dishkept-age.key`;
  4. always removes the key file, in an `always:` block;
  5. fails unless the output contains `DRILL PASSED`.

## 5. Changes to the `prod:*` scripts

- **`prod:deploy --no-tunnel`:** brings the stack up without the `tunnel` Compose profile or the backup loop, and prints that the site won't be reachable. A stack that takes no traffic must not upload its own empty database as the bucket's newest backup (final review).
- **`prod:restore-test --key-file <path>`:** uses that path instead of asking. The drill is otherwise unchanged, and still never starts the tunnel.
- Both flags are parsed in `scripts/prod/lib.mjs` and unit-tested there.

## 6. First-time setup, and the trial

Each `tofu apply` is shown as a plan first, and applied only after the owner says yes.

1. **The owner:**
   - creates the Cloudflare API token;
   - makes the `age` key pair (RUNBOOK step 5);
   - has the Zoho app password and the Claude key ready;
   - chooses the bucket name and a Vault password, both saved in the password manager.
2. `infra/bootstrap.sh`.
3. `tofu apply`. Its output is the nameservers.
4. **The owner:** pastes the nameservers at Porkbun. **Check:** Cloudflare shows **Active**.
5. `pnpm infra:secrets`. The Vault file is committed in its own PR.
6. `ansible-playbook site.yml -l pc --check --diff`, then without `--check`.
   - **Check:** RUNBOOK step 7's checks: the tunnel is Healthy, the site loads over mobile data, and the code arrives.
   - **Check:** a second run reports `changed=0`.
7. `pnpm prod:backup-now`, then `pnpm prod:restore-test`. **Check:** `DRILL PASSED`.
8. **The VM trial:**
   - `tofu apply -var vm=true`, then `ansible-playbook trial.yml -l vm`. **Check:** `DRILL PASSED`;
   - then `tofu apply -var vm=false`. **Check:** `gcloud compute instances list` is empty.

## 7. Testing

- **Unit tests (vitest, `scripts/**/*.test.mjs`):**
  - `infra:secrets` builds the env text from the example, generated values, answers and outputs;
  - `--refresh` replaces only the three values from OpenTofu;
  - nothing is written in plaintext (the encrypt step is given stdin, checked with an injected runner);
  - `--no-tunnel` gives a Compose command without `--profile tunnel`;
  - `--key-file` reaches the drill without a prompt.
- **`pnpm test:infra`** (new), also run in CI's static job:
  - `tofu fmt -check -recursive infra/tofu` and `tofu validate`, using `tofu init -backend=false`;
  - `ansible-playbook --syntax-check` on both playbooks;
  - `ansible-lint infra/ansible`.

  CI installs OpenTofu with `opentofu/setup-opentofu`, and Ansible and ansible-lint with pip.
- **The real test** is §6 steps 2–8, with each command's result recorded in the PR or the ledger.

## 8. Docs

- **ADR-0021, "Infrastructure as code with OpenTofu and Ansible":**
  - the split, the Vault file, and the PC and VM targets;
  - why not cloud-init alone (no PC story), Ansible alone (no state or plan, and messy teardown), or Secret Manager (a GCP dependency for the PC).
- **`docs/RUNBOOK.md`:**
  - first-time setup is rewritten as §6. The manual Cloud Shell and dashboard steps are removed;
  - "Rotating secrets" changes to edit the Vault file, then re-run Ansible;
  - "Moving to a VM later" becomes:
    1. `tofu apply -var vm=true`;
    2. `site.yml -l vm -e tunnel=false`;
    3. `prod:restore` on the VM;
    4. `prod:stop` on the PC;
    5. `site.yml -l vm` (with the tunnel on).
- **`ARCHITECTURE.md`:** the deployment view names OpenTofu and Ansible.
- **`CLAUDE.md`:** the commands `infra:secrets` and `test:infra`.
- **`infra/README.md`:** prerequisites (tool versions) and how to run each piece.
