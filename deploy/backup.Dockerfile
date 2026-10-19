# Nightly backup (production spec §5): pg_dump, tar, age, rclone, msmtp.
FROM postgres:17-alpine
RUN apk add --no-cache age rclone msmtp tzdata coreutils
COPY scripts/backup/ /opt/backup/
RUN chmod +x /opt/backup/*.sh
ENTRYPOINT ["/opt/backup/run.sh"]
CMD ["loop"]
