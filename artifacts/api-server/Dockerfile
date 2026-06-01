FROM node:22-alpine AS builder
RUN npm install -g pnpm@9 --no-update-notifier

WORKDIR /workspace

# Copy workspace manifests first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy lib package manifests
COPY lib/db/package.json lib/db/
COPY lib/api-zod/package.json lib/api-zod/
COPY artifacts/api-server/package.json artifacts/api-server/

# Install all dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source files
COPY lib/db/ lib/db/
COPY lib/api-zod/ lib/api-zod/
COPY artifacts/api-server/ artifacts/api-server/

# Build the API server (esbuild bundles workspace deps into dist/)
RUN pnpm --filter @workspace/api-server run build

# ---- runtime image ----
FROM node:22-alpine AS runner
WORKDIR /app

# Copy bundled output (esbuild-plugin-pino inlines pino transports)
COPY --from=builder /workspace/artifacts/api-server/dist ./dist

# Copy only the hoisted node_modules needed for runtime externals
# (bufferutil, utf-8-validate, pg-native are optional; pino-pretty is bundled by plugin)
COPY --from=builder /workspace/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
