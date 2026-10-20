# 0021. Infrastructure as code with OpenTofu and Ansible

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

ADR-0018 runs production on the owner's PC, set up by hand from the RUNBOOK:
- Cloudflare's dashboard, for the zone and the tunnel;
- Cloud Shell, for the backup bucket;
- a hand-made clone and env file.

The owner wants that setup as code. It must work for the PC now and for a cloud VM later, because this app is a proving ground for one that must be hosted elsewhere.

## Decision

1. **OpenTofu** (`infra/tofu`) owns the cloud resources:
   - Cloudflare: the zone, the tunnel, its hostname rule and the DNS record;
   - GCS: the backup bucket, with its 30-day rule and its create-and-view-only service account;
   - a GCP VM, created only while `vm = true`. It has no external IP, outbound goes through Cloud NAT, and SSH only through IAP with OS Login.

   State is in a private, versioned GCS bucket made once by `infra/bootstrap.sh`.
2. **Ansible** (`infra/ansible`) owns the host. There are two hosts, `pc` and `vm`, and a run names one. Its roles:
   - install Docker and Node on the VM;
   - keep a clean `main` clone;
   - write the env file and the key;
   - run `pnpm prod:deploy`.

   The `prod:*` scripts stay the one way to operate production.
3. **Secrets** live in an Ansible Vault file in the private repo, built by `pnpm infra:secrets` from OpenTofu's outputs and the owner's answers. It is unlocked by one password, kept in the owner's password manager. The backup `age` secret key stays outside it.
4. **A VM trial** proves the move: create the VM, deploy without the tunnel, run the restore drill on the PC's latest backup, destroy the VM.

## Consequences

- Production can be rebuilt from the repo, the Vault password and the cloud credentials, even if the PC is lost.
- Two tools to install (OpenTofu, Ansible), and CI checks both statically (`pnpm test:infra`).
- The Porkbun nameserver change and the Windows power settings stay manual.
- The VM clones the private repo with a read-only GitHub token from the Vault file. It must be rotated before it expires.

## Alternatives considered

- **cloud-init with OpenTofu only:** no story for the PC.
- **Ansible only, with its cloud modules:** no state or plan, so drift goes unseen and teardown is messy.
- **GCP Secret Manager:** a cloud dependency for the PC target.
- **Copying `.env.production` from the PC:** the secrets die with the PC.
