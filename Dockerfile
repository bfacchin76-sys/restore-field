# RestoreField multi-stage Dockerfile.
#
# The same image is run with two different commands per PRD §5/§13:
#   - app:    `node server.js`         (Next.js standalone server)
#   - worker: `node scripts/worker.js` (BullMQ image-process worker)
#
# `docker-compose.yml` will set `command:` accordingly.

# ----- 1. Builder ------------------------------------------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# Cache deps
COPY package.json pnpm-lock.yaml ./
COPY .npmrc ./
RUN pnpm install --frozen-lockfile

# Copy source and generate Prisma client
COPY prisma ./prisma
RUN pnpm prisma generate

COPY . .
RUN pnpm build
# tsx-compile the worker entry too — done at runtime via tsx in dev, but for
# prod we ship the TS files and run via `node --loader tsx`. Simpler: keep
# tsx as a runtime dep and invoke `tsx scripts/worker.ts`.

# ----- 2. Runtime ------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# Sharp + libheif for HEIC support
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libheif1 \
      libvips42 \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/.npmrc ./
RUN pnpm install --prod --frozen-lockfile && pnpm add tsx@4 --save-prod

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/next.config.ts ./

EXPOSE 3000
# Default to the app; worker overrides via `command: ["pnpm", "worker"]`.
CMD ["pnpm", "start"]
