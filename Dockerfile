# syntax=docker/dockerfile:1.7
#
# FieldRestore multi-stage Dockerfile. PRD §13.
#
# The same image is run with two different commands:
#   - app:    pnpm start          (Next.js standalone server)
#   - worker: pnpm worker         (BullMQ workers — image / counts / report)
#
# `docker-compose.yml` overrides the `command:` for the worker service.

ARG NODE_VERSION=22-bookworm-slim

# ----- 1. Builder ------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

# Cache deps.
COPY package.json pnpm-lock.yaml ./
COPY .npmrc* ./
RUN pnpm install --frozen-lockfile

# Generate Prisma client.
COPY prisma ./prisma
RUN pnpm exec prisma generate

# Build Next standalone bundle.
COPY . .
RUN pnpm build

# ----- 2. Runtime ------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

# Sharp + Puppeteer/Chromium runtime libs + HEIC.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tini \
      ca-certificates \
      openssl \
      libheif1 \
      libvips42 \
      fonts-liberation \
      fonts-noto-color-emoji \
      libnss3 \
      libxshmfence1 \
      libxcomposite1 \
      libxrandr2 \
      libxdamage1 \
      libxfixes3 \
      libxkbcommon0 \
      libpango-1.0-0 \
      libcups2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libxss1 \
      libgbm1 \
      libasound2 \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# Production deps + tsx for the worker entrypoint.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/.npmrc* ./
RUN pnpm install --prod --frozen-lockfile

# App + worker payloads.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Run prisma migrate deploy on app boot, then start the server.
COPY docker/entrypoint-app.sh /usr/local/bin/entrypoint-app.sh
RUN chmod +x /usr/local/bin/entrypoint-app.sh

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/entrypoint-app.sh"]
