# syntax=docker/dockerfile:1.7
#
# FieldRestore multi-stage Dockerfile. PRD §13.

ARG NODE_VERSION=22-bookworm-slim
ARG PNPM_VERSION=10.33.0

# ----- 1. Builder ------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# OpenSSL CLI lets Prisma's generator detect the right libssl version
# so it emits the engine binary that matches the runtime stage (also
# Debian 12, openssl 3.0). Without this it falls back to 1.1.x which
# doesn't exist on the runtime image — causing the "libssl.so.1.1: no
# such file" failure.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY package.json pnpm-lock.yaml ./
COPY .npmrc* ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
RUN pnpm exec prisma generate

# Build-time env placeholders. Next 16's "collect page data" pass
# evaluates module-level code, and the app's env.ts validator
# throws on missing required vars even though they're only used at
# runtime. These are NEVER used at runtime — Fly secrets override
# them at boot.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    SHADOW_DATABASE_URL="postgresql://build:build@localhost:5432/build_shadow" \
    REDIS_URL="redis://localhost:6379" \
    S3_ENDPOINT="http://localhost:9000" \
    S3_REGION="us-east-1" \
    S3_ACCESS_KEY="build" \
    S3_SECRET_KEY="build" \
    S3_BUCKET="build" \
    S3_FORCE_PATH_STYLE="true" \
    AUTH_SECRET="build-only-placeholder-replaced-by-fly-secrets-at-runtime" \
    NEXTAUTH_URL="http://localhost:3000" \
    NEXTAUTH_SECRET="build-only-placeholder-replaced-by-fly-secrets-at-runtime" \
    SMTP_HOST="" \
    SMTP_PORT="587" \
    SMTP_USER="" \
    SMTP_PASS="" \
    SMTP_FROM="FieldRestore <noreply@example.com>" \
    INITIAL_OWNER_EMAIL="build@example.com" \
    INITIAL_OWNER_PASSWORD="build-only-placeholder" \
    INITIAL_OWNER_NAME="Build" \
    ORG_NAME="Build Org" \
    ORG_SLUG="build-org" \
    ORG_PRIMARY_COLOR="#000000" \
    ORG_REPORT_FOOTER=""

COPY . .
RUN pnpm build

# ----- 2. Runtime ------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ARG PNPM_VERSION

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
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Copy the dependency tree wholesale from the builder. With pnpm,
# trying to COPY just ".prisma" fails (it lives inside .pnpm). Copying
# the whole node_modules keeps the symlink structure intact and the
# generated Prisma client comes along for free. Slightly larger image
# than `pnpm install --prod`, but reliable.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/next.config.ts ./

COPY docker/entrypoint-app.sh /usr/local/bin/entrypoint-app.sh
RUN chmod +x /usr/local/bin/entrypoint-app.sh

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/entrypoint-app.sh"]
