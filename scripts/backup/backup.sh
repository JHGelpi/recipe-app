#!/bin/sh
# One backup: app database + photos + manifest, age-encrypted, uploaded, 7 kept locally.
set -eu
# A failing tar or age inside a pipe must fail the script, not upload a partial file.
set -o pipefail
export PGHOST=db PGUSER=postgres PGDATABASE=app PGPASSWORD="$POSTGRES_PASSWORD"
step=start
work=$(mktemp -d)
# Everything this run prints goes to its log, shown at the end and sent with an alert.
exec 3>&1 4>&2
exec >"$work/log" 2>&1
finish() {
  status=$?
  exec 1>&3 2>&4
  cat "$work/log"
  [ "$status" -eq 0 ] || /opt/backup/alert.sh "$step" "$work/log" || true
  rm -rf "$work"
  exit "$status"
}
trap finish EXIT

stamp=$(date -u +%Y-%m-%dT%H%MZ)
name="dishkept-$stamp.tar.age"

# Any failing query fails the run: set -e does not see failures inside $( ) in a heredoc.
q() { psql -v ON_ERROR_STOP=1 -Atc "$1"; }
number() {
  case "$1" in '' | *[!0-9]*) echo "not a count: '$1'" >&2; exit 1 ;; esac
  printf '%s' "$1"
}

step=prune-passes
psql -v ON_ERROR_STOP=1 -qc "delete from public.signup_passes where expires_at <= now()"

step=dump
pg_dump --format=custom --file="$work/app.dump" app

step=photos
tar -C /data/photos -cf "$work/photos.tar" .

step=manifest
migration=$(q 'select max(version) from dbmate.schema_migrations')
users=$(number "$(q 'select count(*) from auth.users')")
households=$(number "$(q 'select count(*) from public.households')")
memberships=$(number "$(q 'select count(*) from public.memberships')")
recipes=$(number "$(q 'select count(*) from public.recipes')")
photos=$(number "$(q 'select count(*) from public.photos')")
shares=$(number "$(q 'select count(*) from public.shares')")
files=$(number "$(find /data/photos -type f | wc -l | tr -d ' ')")
# One photo's bytes, so a drill can prove files come back intact, not only counted.
# sed -n 1p reads all its input: head would end the pipe early, and pipefail fail it.
sample=$(cd /data/photos && find . -type f -name '*.jpg' | sed 's|^\./||' | sort | sed -n 1p)
if [ -n "$sample" ]; then
  check=$(jq -n --arg file "$sample" --arg sha256 "$(sha256sum "/data/photos/$sample" | cut -d' ' -f1)" \
    '{file: $file, sha256: $sha256}')
else
  check=null
fi
jq -n --arg date "${stamp%%T*}" --arg time "$stamp" --arg build "${BUILD_TIME:-unknown}" \
  --arg migration "$migration" --argjson check "$check" \
  --argjson users "$users" --argjson households "$households" --argjson memberships "$memberships" \
  --argjson recipes "$recipes" --argjson photos "$photos" --argjson shares "$shares" \
  --argjson files "$files" \
  '{date: $date, time: $time, build: $build, migration: $migration,
    counts: {users: $users, households: $households, memberships: $memberships,
             recipes: $recipes, photos: $photos, shares: $shares, photo_files: $files},
    photo_check: $check}' > "$work/manifest.json"

step=encrypt
tar -C "$work" -cf - app.dump photos.tar manifest.json | age -r "$BACKUP_AGE_RECIPIENT" -o "/backups/$name"

step=upload
rclone copyto "/backups/$name" "${BACKUP_REMOTE:-offsite:$BACKUP_BUCKET}/$name"

step=prune-local
ls -1 /backups/dishkept-*.tar.age | sort | head -n -7 | xargs -r rm --

date -u +%FT%TZ > /backups/last-success
echo "backup ok: $name"
