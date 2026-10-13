FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS build
COPY . .
# Build contains no real secrets. Runtime requires its own SESSION_SECRET.
ENV NODE_ENV=production NITRO_PRESET=node-server
RUN SESSION_SECRET=build-placeholder npm run build

FROM dependencies AS database-init
COPY scripts ./scripts
USER node
CMD ["node", "scripts/docker-db-init.mjs"]

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends default-mysql-client \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/.output ./.output
RUN mkdir backup && chown node:node backup
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/auth/me').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
