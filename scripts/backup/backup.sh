#!/bin/sh
# One backup: app database + photos + manifest, age-encrypted, uploaded, 7 kept locally.
set -eu
export PGHOST=db PGUSER=postgres PGDATABASE=app PGPASSWORD="$POSTGRES_PASSWORD"
step=start
work=$(mktemp -d)
trap 'status=$?; rm -rf "$work"; [ $status -eq 0 ] || /opt/backup/alert.sh "$step" "$work"; exit $status' EXIT

day=$(date +%F)
name="dishkept-$day.tar.age"

step=prune-passes
psql -v ON_ERROR_STOP=1 -qc "delete from public.signup_passes where expires_at <= now()"

step=dump
pg_dump --format=custom --file="$work/app.dump" app

step=photos
tar -C /data/photos -cf "$work/photos.tar" .

step=manifest
count() { psql -Atc "select count(*) from $1"; }
cat > "$work/manifest.json" <<EOF
{"date":"$day","build":"${BUILD_TIME:-unknown}",
 "migration":"$(psql -Atc 'select max(version) from dbmate.schema_migrations')",
 "counts":{"users":$(count auth.users),"households":$(count public.households),
  "memberships":$(count public.memberships),"recipes":$(count public.recipes),
  "photos":$(count public.photos),"shares":$(count public.shares),
  "photo_files":$(find /data/photos -type f | wc -l)}}
EOF

step=encrypt
tar -C "$work" -cf - app.dump photos.tar manifest.json | age -r "$BACKUP_AGE_RECIPIENT" -o "/backups/$name"

step=upload
rclone copyto "/backups/$name" "${BACKUP_REMOTE:-offsite:$BACKUP_BUCKET}/$name"

step=prune-local
ls -1 /backups/dishkept-*.tar.age | sort | head -n -7 | xargs -r rm --

date -u +%FT%TZ > /backups/last-success
echo "backup ok: $name"
