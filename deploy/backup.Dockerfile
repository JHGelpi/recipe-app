# Nightly backup (production spec §5): pg_dump, tar, age, rclone, msmtp.
FROM postgres:17.11-alpine@sha256:e5d2edd28b1f8d40a0a6c0c9cdc545b19b56a0d5d88f94bc11a97d970d4700d0
RUN apk add --no-cache age rclone msmtp tzdata coreutils jq
COPY scripts/backup/ /opt/backup/
RUN chmod +x /opt/backup/*.sh
ENTRYPOINT ["/opt/backup/run.sh"]
CMD ["loop"]
