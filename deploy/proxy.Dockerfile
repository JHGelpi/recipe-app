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
# No EXPO_PUBLIC_* values are set: the bundle uses same-origin paths, so this
# image is identical on every host.
ENV METRO_MAX_WORKERS=2
RUN pnpm --filter mobile run build:web

FROM caddy:2
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/email-templates /srv/email-templates
COPY --from=web /repo/apps/mobile/dist /srv/web
