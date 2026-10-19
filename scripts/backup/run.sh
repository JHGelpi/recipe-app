#!/bin/sh
# now: one backup. tick: back up if the latest BACKUP_TIME slot (TZ) was never
# tried, so a slot missed while the PC was off or asleep runs once it is back.
# loop: tick every 15 minutes. restore <file>: see restore.sh.
set -eu

tick() {
  slot=$(date -d "today ${BACKUP_TIME:-03:30}" +%s)
  [ "$(date +%s)" -lt "$slot" ] && slot=$(date -d "yesterday ${BACKUP_TIME:-03:30}" +%s)
  tried=$(cat /backups/last-attempt 2>/dev/null || echo 0)
  if [ "$tried" -ge "$slot" ]; then
    echo "not due"
    return 0
  fi
  # Recorded first: a failing backup alerts once per slot, not every 15 minutes.
  echo "$slot" > /backups/last-attempt
  /opt/backup/backup.sh
}

case "${1:-loop}" in
  now) exec /opt/backup/backup.sh ;;
  tick) tick ;;
  restore) shift; exec /opt/backup/restore.sh "$@" ;;
  status) cat /backups/last-success 2>/dev/null || echo never ;;
  loop)
    while :; do
      tick || true # backup.sh has already sent the alert
      sleep 900
    done ;;
  *) echo "usage: run.sh now|tick|loop|status|restore <file>" >&2; exit 2 ;;
esac
