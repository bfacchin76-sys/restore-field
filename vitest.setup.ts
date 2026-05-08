// Load .env.local so integration tests (Postgres, Redis) get real
// connection strings. Then fall back to safe stubs for any var still
// missing — pure unit tests don't need a real DB but still import
// modules that read env at module scope.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const envFile = resolve(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.AUTH_SECRET ??= "test-secret-not-real";

import "@testing-library/jest-dom/vitest";
