FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
# Manifests first, so the dependency layer is cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile --filter '@recipe-app/api...'
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/api apps/api
RUN pnpm --filter @recipe-app/api run build

# One bundled file; no node_modules in the runtime image.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/api/dist/server.cjs ./server.cjs
# The photos volume takes this directory's owner when first created.
RUN mkdir -p /data/photos && chown node:node /data/photos
USER node
EXPOSE 3000
HEALTHCHECK --interval=2s --timeout=5s --retries=30 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.cjs"]
