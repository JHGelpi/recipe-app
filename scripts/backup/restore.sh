#!/bin/sh
# restore <file.tar.age>: decrypt with /run/secrets/age.key, then replace the
# app database and the photos. The caller has stopped api, auth, sync, proxy.
set -eu
# A failing tar or age inside a pipe must fail the script, not upload a partial file.
set -o pipefail
file="$1"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export PGHOST=db PGUSER=postgres PGPASSWORD="$POSTGRES_PASSWORD"

# Decrypt and unpack first: a wrong key or a corrupt file stops here, before anything is dropped.
age -d -i /run/secrets/age.key "$file" | tar -C "$work" -xf -
[ -s "$work/app.dump" ] || { echo "restore: no database dump in the backup" >&2; exit 1; }
[ -f "$work/photos.tar" ] || { echo "restore: no photos in the backup" >&2; exit 1; }
[ -f "$work/manifest.json" ] || { echo "restore: no manifest in the backup" >&2; exit 1; }
cat "$work/manifest.json"
# prod:restore restarts the stack unchanged unless this line was printed.
echo "restore: replacing"

psql -d postgres -v ON_ERROR_STOP=1 -qc "drop database if exists app with (force)"
pg_restore --create --dbname=postgres --exit-on-error "$work/app.dump"
find /data/photos -mindepth 1 -delete
tar -C /data/photos -xf "$work/photos.tar"
echo "restore ok"
