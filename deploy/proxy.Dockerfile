FROM node:22.23.4-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS web
WORKDIR /repo
RUN corepack enable
# Manifests first, so the dependency layer is cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile --filter 'mobile...'
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/mobile apps/mobile
# Only the build time is set: the bundle uses same-origin paths, so this image
# holds no host name or key and runs on every host. The time shows in the
# app's footer; the layer is reused, time included, when no source changed.
ENV METRO_MAX_WORKERS=2
RUN EXPO_PUBLIC_BUILD_TIME="$(date -u '+%Y-%m-%d %H:%M')" pnpm --filter mobile run build:web

FROM caddy:2.11.7@sha256:5e5286cb37d44086d651a5363f05f43a692ce4d649d88fb1bd844579f45fa9e8
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/email-templates /srv/email-templates
COPY --from=web /repo/apps/mobile/dist /srv/web
# Outside every served root: prod:deploy reads the running version from it (FR-47).
COPY RELEASE_NOTES.md /etc/dishkept/RELEASE_NOTES.md
