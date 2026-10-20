#!/bin/sh
# msmtp's TLS flags for an SMTP port: STARTTLS on 587, none for Mailpit's 1025
# (tests), implicit TLS otherwise (465).
case "${1:-}" in
  587) echo '--tls=on --tls-starttls=on' ;;
  1025) echo '--tls=off --tls-starttls=off' ;;
  *) echo '--tls=on --tls-starttls=off' ;;
esac
