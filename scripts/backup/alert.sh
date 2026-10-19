#!/bin/sh
# Emails the owner that a backup failed, through the stack's SMTP settings.
set -u
to="${BACKUP_ALERT_TO:-$SMTP_FROM}"
tls=on; [ "${SMTP_PORT:-}" = 1025 ] && tls=off # Mailpit in tests
{
  printf 'From: %s <%s>\nTo: %s\nSubject: Dishkept backup FAILED (%s)\n\n' \
    "${SMTP_SENDER_NAME:-Dishkept}" "$SMTP_FROM" "$to" "$1"
  echo "The nightly backup failed at step: $1"
  echo "Run: pnpm prod:logs backup"
} | msmtp --host="$SMTP_HOST" --port="$SMTP_PORT" --tls="$tls" --tls-starttls=off \
    --auth="$([ -n "${SMTP_USER:-}" ] && echo on || echo off)" --user="${SMTP_USER:-}" \
    --passwordeval="printf %s \"\$SMTP_PASS\"" --from="$SMTP_FROM" "$to"
