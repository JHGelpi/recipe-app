#!/bin/sh
# Vault password client: infra:secrets passes the password to ansible-vault
# through the environment of that one child process, never through a file.
printf '%s\n' "${DISHKEPT_VAULT_PASS:?}"
