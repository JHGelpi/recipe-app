# Nightly backup (production spec §5): pg_dump, tar, age, rclone, msmtp.
FROM postgres:17.11-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b
RUN apk add --no-cache age rclone msmtp tzdata coreutils jq
COPY scripts/backup/ /opt/backup/
RUN chmod +x /opt/backup/*.sh
ENTRYPOINT ["/opt/backup/run.sh"]
CMD ["loop"]
