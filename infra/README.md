# Dishkept infrastructure

OpenTofu (`tofu/`) creates the cloud resources, and Ansible (`ansible/`) sets up the machine production runs on: the PC or a GCP VM (ADR-0021). `docs/RUNBOOK.md` gives the order; this file has the commands.

Nothing here writes a secret in plaintext. The Vault file (`ansible/group_vars/all/vault.yml`) is encrypted, and its password lives only in your password manager.

## 1. Tools

| Tool | Version | Check |
|---|---|---|
| OpenTofu | 1.8 or later | `tofu version` |
| Ansible core | 2.13 or later | `ansible --version` |
| ansible-lint (for `pnpm test:infra`) | current | `ansible-lint --version` |
| gcloud CLI | current | `gcloud version` |

ansible-lint needs Python 3.10 or later. On an older system Python, install it in a virtualenv: `python3.11 -m venv ~/.local/share/ansible-lint-venv && ~/.local/share/ansible-lint-venv/bin/pip install ansible-core ansible-lint`, then link `bin/ansible-lint` into `~/.local/bin`.

**For the VM only, once:** add your SSH key to OS Login:

```sh
gcloud compute os-login ssh-keys add --key-file ~/.ssh/google_compute_engine.pub
```

If you have no key yet, `ssh-keygen -t ed25519 -f ~/.ssh/google_compute_engine` makes one.

## 2. Credentials (each session)

```sh
gcloud auth application-default login
export CLOUDFLARE_API_TOKEN=...       # Zone:Edit, DNS:Edit, Cloudflare Tunnel:Edit on your account
export TF_VAR_project=...             # your GCP project id
export TF_VAR_cloudflare_account_id=...
export TF_VAR_backup_bucket=...       # e.g. dishkept-backups-<something>; globally unique
export TF_VAR_owner_member=user:...   # your Google account, for SSH to the VM
# Ansible on a Windows drive (/mnt/*) ignores ansible.cfg unless it's named:
export ANSIBLE_CONFIG=$PWD/infra/ansible/ansible.cfg
# For the VM only:
export DISHKEPT_GCP_PROJECT=$TF_VAR_project
export DISHKEPT_VM_USER=...           # your OS Login user, e.g. you_example_com
```

`gcloud compute os-login describe-profile --format='value(posixAccounts[0].username)'` prints the OS Login user.

## 3. First time: state, then the cloud

```sh
infra/bootstrap.sh                    # the state bucket; safe to re-run
cd infra/tofu
tofu init -backend-config=bucket=$TF_VAR_project-dishkept-tofu-state
tofu import cloudflare_zone.site <zone id>   # only if the zone already exists in Cloudflare
tofu plan                              # read it
tofu apply
tofu output nameservers               # paste these at Porkbun (RUNBOOK), unless the zone is already Active
cd ../..
```

## 4. The Vault file

```sh
pnpm infra:secrets             # first time: generates passwords and keys, asks for the rest
pnpm infra:secrets --edit      # change a value (a rotation)
pnpm infra:secrets --refresh   # re-read the tunnel token, bucket and key from OpenTofu
```

The first run asks for:
- the Zoho login, app password and From address;
- the Claude key;
- the `age1…` public key;
- your sign-in email;
- a GitHub fine-grained token (Contents: Read, this repo only), which the VM clones with;
- a new Vault password.

Commit `infra/ansible/group_vars/all/vault.yml` afterwards. Check that it's encrypted first: its first line is `$ANSIBLE_VAULT;1.1;AES256`.

## 5. Ansible

Run these from `infra/ansible`, always naming one host:

```sh
ansible-playbook site.yml -l pc --check --diff --ask-vault-pass   # dry run first
ansible-playbook site.yml -l pc --ask-vault-pass
ansible-playbook site.yml -l pc -e force_deploy=true --ask-vault-pass   # deploy with nothing new
ansible-playbook site.yml -l vm -e tunnel=false --ask-vault-pass        # a VM that takes no traffic
```

A second run with nothing new reports `changed=0`.

**If a run fails partway** (for example, Docker Desktop wasn't running), fix the cause and run it again with `-e force_deploy=true`. Nothing new in the checkout means the next plain run wouldn't redeploy.

## 6. The VM trial

The VM is an `e2-micro` (Google's free tier) with a 30 GB standard disk and a 2 GB swap file. Its first build of the web image is slow, about 15 to 30 minutes. If it runs out of memory, add `-var machine_type=e2-small` (2 GB, a few cents for the trial) to both `tofu apply` lines.

```sh
cd infra/tofu && tofu apply -var vm=true && cd ../ansible
ansible-playbook trial.yml -l vm --ask-vault-pass     # asks for your AGE-SECRET-KEY line; ends with DRILL PASSED
cd ../tofu && tofu apply -var vm=false                # removes the VM, NAT and network
gcloud compute instances list                         # empty
```

## 7. Static checks

`pnpm test:infra` runs `tofu fmt -check`, `tofu validate`, Ansible's syntax check and ansible-lint. It touches no cloud account, and CI runs it too.
