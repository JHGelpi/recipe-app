#!/bin/sh
# Emails the owner that a backup failed, with the run's last 30 lines, through
# the stack's SMTP settings. `alert.sh test` sends a test message instead.
set -u
to="${BACKUP_ALERT_TO:-$SMTP_FROM}"
if [ "$1" = test ]; then
  subject='Dishkept alert test'
  text='This is a test of the backup alert. Nothing failed.'
else
  subject="Dishkept backup FAILED ($1)"
  text="The nightly backup failed at step: $1"
fi
{
  printf 'From: %s <%s>\nTo: %s\nDate: %s\nSubject: %s\n\n' \
    "${SMTP_SENDER_NAME:-Dishkept}" "$SMTP_FROM" "$to" "$(date -R)" "$subject"
  echo "$text"
  if [ -n "${2:-}" ] && [ -s "$2" ]; then
    echo
    echo "Last lines of the run:"
    tail -n 30 "$2"
  fi
  echo
  echo "Run: pnpm prod:logs backup"
} | msmtp --host="$SMTP_HOST" --port="$SMTP_PORT" $(/opt/backup/smtp-tls.sh "$SMTP_PORT") \
    --auth="$([ -n "${SMTP_USER:-}" ] && echo on || echo off)" --user="${SMTP_USER:-}" \
    --passwordeval="printf %s \"\$SMTP_PASS\"" --from="$SMTP_FROM" "$to"
