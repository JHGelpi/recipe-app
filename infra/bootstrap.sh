#!/bin/sh
# One-time: the private, versioned bucket that holds OpenTofu's state
# (infrastructure spec §3). Safe to re-run: it changes nothing once the bucket exists.
set -eu
PROJECT=$(gcloud config get-value project 2>/dev/null)
[ -n "$PROJECT" ] || { echo "Set a project: gcloud config set project <id>" >&2; exit 1; }
BUCKET="gs://${PROJECT}-dishkept-tofu-state"
if gcloud storage buckets describe "$BUCKET" >/dev/null 2>&1; then
  echo "$BUCKET exists."
else
  gcloud storage buckets create "$BUCKET" --location=us-east1 \
    --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets update "$BUCKET" --versioning
  echo "Created $BUCKET."
fi
echo "Next: cd infra/tofu && tofu init -backend-config=bucket=${PROJECT}-dishkept-tofu-state"
