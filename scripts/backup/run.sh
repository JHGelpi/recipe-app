#!/bin/sh
# now: one backup. loop: one a day at BACKUP_TIME (TZ). restore <file>: see restore.sh.
set -eu
case "${1:-loop}" in
  now) exec /opt/backup/backup.sh ;;
  restore) shift; exec /opt/backup/restore.sh "$@" ;;
  status) cat /backups/last-success 2>/dev/null || echo never ;;
  loop)
    while :; do
      target=$(date -d "today ${BACKUP_TIME:-03:30}" +%s)
      now=$(date +%s)
      [ "$target" -le "$now" ] && target=$(date -d "tomorrow ${BACKUP_TIME:-03:30}" +%s)
      sleep $((target - now))
      /opt/backup/backup.sh || true # backup.sh has already sent the alert
    done ;;
  *) echo "usage: run.sh now|loop|status|restore <file>" >&2; exit 2 ;;
esac
