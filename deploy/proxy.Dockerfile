FROM node:22.23.5-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS web
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

FROM caddy:2.11.9@sha256:4851e54a46b206517c574821bb5cc67f170d2156041e9fbc4c9193b45e84a75b
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/email-templates /srv/email-templates
COPY --from=web /repo/apps/mobile/dist /srv/web
# Outside every served root: prod:deploy reads the running version from it (FR-47).
COPY RELEASE_NOTES.md /etc/dishkept/RELEASE_NOTES.md
