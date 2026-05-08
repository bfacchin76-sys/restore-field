#!/bin/sh
set -eu

# Apply pending Prisma migrations idempotently before booting the web
# server. PRD §13: "App container runs `prisma migrate deploy`."
echo "[entrypoint] running prisma migrate deploy…"
pnpm exec prisma migrate deploy

# Run the seed only if no Organization exists. The seed is idempotent
# but the first-boot guard avoids noise on every restart.
echo "[entrypoint] seed-if-empty…"
pnpm exec node -e "
  (async () => {
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    try {
      const n = await p.organization.count();
      if (n === 0) {
        console.log('[entrypoint] no orgs — running seed');
        require('child_process').spawnSync('pnpm', ['seed'], { stdio: 'inherit' });
      } else {
        console.log('[entrypoint] orgs exist (' + n + ') — skipping seed');
      }
    } finally {
      await p.\$disconnect();
    }
  })();
"

echo "[entrypoint] starting Next.js…"
exec pnpm start
