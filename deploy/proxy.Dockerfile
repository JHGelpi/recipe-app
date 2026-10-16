FROM node:22-slim AS web
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

FROM caddy:2
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/email-templates /srv/email-templates
COPY --from=web /repo/apps/mobile/dist /srv/web
