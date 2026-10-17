# syntax=docker/dockerfile:1.7
# Ordler: one image with the API, the worker and the built web app (SPEC §16.1).

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /src
ENV TURBO_TELEMETRY_DISABLED=1 \
    CI=true
RUN corepack enable

# Dependencies first, so source edits do not invalidate the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build \
 && pnpm --filter @ordler/api deploy --legacy --prod /out \
 && cp -r apps/web/dist /out/public

FROM ${NODE_IMAGE} AS runtime
ARG ORDLER_VERSION=""
LABEL org.opencontainers.image.title="Ordler" \
      org.opencontainers.image.description="Task management inside and between departments" \
      org.opencontainers.image.source="https://github.com/Elkhan-Isayev/ordler" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${ORDLER_VERSION}"

ENV NODE_ENV=production \
    PORT=3000 \
    ORDLER_DATA_DIR=/data \
    ORDLER_WEB_DIR=/app/public \
    ORDLER_VERSION=${ORDLER_VERSION}

WORKDIR /app
COPY --from=build --chown=node:node /out /app
# The data volume holds installer-saved database settings and the generated encryption key.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
