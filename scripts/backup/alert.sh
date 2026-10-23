#!/bin/sh
# Emails the owner that a backup failed, with the run's last 30 lines, through
# the stack's SMTP settings. `alert.sh test` sends a test message instead.
# FR-46: plain text and a branded HTML version of the same content, so it
# reads anywhere; the HTML's logo loads from the public address (PUBLIC_URL).
set -u
to="${BACKUP_ALERT_TO:-$SMTP_FROM}"
site="${PUBLIC_URL:-https://dishkept.geltech.dev}"
if [ "$1" = test ]; then
  subject='Dishkept alert test'
  text='This is a test of the backup alert. Nothing failed.'
else
  subject="Dishkept backup FAILED ($1)"
  text="The nightly backup failed at step: $1"
fi
lines=''
if [ -n "${2:-}" ] && [ -s "$2" ]; then lines="$(tail -n 30 "$2")"; fi
boundary="dishkept-$(date +%s)-$$"

# Text for HTML: the log can hold anything, so &, < and > are escaped.
escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

plain() {
  echo "$text"
  if [ -n "$lines" ]; then
    echo
    echo "Last lines of the run:"
    printf '%s\n' "$lines"
  fi
  echo
  echo "Run: pnpm prod:logs backup"
  echo
  echo "Dishkept · $site"
}

# Light palette of ADR-0017, inline and in tables, as the sign-in email.
html() {
  font="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
  mono="'SF Mono', Menlo, Consolas, 'Courier New', monospace"
  cat <<EOF
<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" /><meta name="supported-color-schemes" content="light" />
<title>$(escape "$subject")</title></head>
<body style="margin: 0; padding: 0; background-color: #f6f7f9; color: #0e121a; font-family: $font">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F6F7F9" style="background-color: #f6f7f9"><tr><td align="center" style="padding: 32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px">
<tr><td style="padding: 0 0 24px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right: 12px"><img src="$site/email-templates/logo.png" width="56" height="56" alt="Dishkept" style="display: block; border: 0; width: 56px; height: 56px; border-radius: 12px" /></td>
<td valign="middle" style="font-size: 24px; font-weight: 700; line-height: 1.2; color: #0e121a">Dishkept</td>
</tr></table></td></tr>
<tr><td bgcolor="#FFFFFF" style="background-color: #ffffff; border: 1px solid #d3d9e3; border-radius: 16px; padding: 28px 24px">
<h1 style="margin: 0 0 12px 0; font-size: 20px; line-height: 1.3; font-weight: 700; color: #0e121a">$(escape "$subject")</h1>
<p style="margin: 0; font-size: 16px; line-height: 1.5; color: #0e121a">$(escape "$text")</p>
EOF
  if [ -n "$lines" ]; then
    cat <<EOF
<p style="margin: 20px 0 8px 0; font-size: 14px; line-height: 1.5; color: #535c6e">Last lines of the run:</p>
<pre style="margin: 0; padding: 12px; background-color: #eceff4; border-radius: 8px; font-family: $mono; font-size: 12px; line-height: 1.5; color: #0e121a; white-space: pre-wrap; word-break: break-word">$(escape "$lines")</pre>
EOF
  fi
  cat <<EOF
<p style="margin: 20px 0 0 0; font-size: 16px; line-height: 1.5; color: #0e121a">Run: <code style="font-family: $mono">pnpm prod:logs backup</code></p>
</td></tr>
<tr><td align="center" style="padding: 20px 0 0 0; font-size: 14px; line-height: 1.5; color: #535c6e"><a href="$site" style="color: #00756a; text-decoration: underline">Open Dishkept</a></td></tr>
</table></td></tr></table></body></html>
EOF
}

{
  printf 'From: %s <%s>\nTo: %s\nDate: %s\nSubject: %s\n' \
    "${SMTP_SENDER_NAME:-Dishkept}" "$SMTP_FROM" "$to" "$(date -R)" "$subject"
  printf 'MIME-Version: 1.0\nContent-Type: multipart/alternative; boundary="%s"\n\n' "$boundary"
  printf -- '--%s\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: 8bit\n\n' "$boundary"
  plain
  printf -- '\n--%s\nContent-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: 8bit\n\n' "$boundary"
  html
  printf -- '\n--%s--\n' "$boundary"
} | msmtp --host="$SMTP_HOST" --port="$SMTP_PORT" $(/opt/backup/smtp-tls.sh "$SMTP_PORT") \
    --auth="$([ -n "${SMTP_USER:-}" ] && echo on || echo off)" --user="${SMTP_USER:-}" \
    --passwordeval="printf %s \"\$SMTP_PASS\"" --from="$SMTP_FROM" "$to"
