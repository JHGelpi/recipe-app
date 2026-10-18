#!/bin/sh
# restore <file.tar.age>: decrypt with /run/secrets/age.key, then replace the
# app database and the photos. The caller has stopped api, auth, sync, proxy.
set -eu
file="$1"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export PGHOST=db PGUSER=postgres PGPASSWORD="$POSTGRES_PASSWORD"

# Decrypt and unpack first: a wrong key or a corrupt file stops here, before anything is dropped.
age -d -i /run/secrets/age.key "$file" | tar -C "$work" -xf -
[ -s "$work/app.dump" ] && [ -f "$work/photos.tar" ] && [ -f "$work/manifest.json" ]
cat "$work/manifest.json"

psql -d postgres -v ON_ERROR_STOP=1 -qc "drop database if exists app with (force)"
pg_restore --create --dbname=postgres --exit-on-error "$work/app.dump"
find /data/photos -mindepth 1 -delete
tar -C /data/photos -xf "$work/photos.tar"
echo "restore ok"
