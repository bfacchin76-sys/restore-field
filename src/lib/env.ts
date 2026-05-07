/**
 * Server-only env access.
 *
 * Centralised so:
 *   - we throw a clear error early when something critical is missing
 *   - tests can stub a single module
 *
 * Don't import this from client components.
 */
import "server-only";

function required(key: string): string {
  const v = process.env[key];
  if (!v || v.length === 0) {
    throw new Error(
      `Missing required env var ${key}. Set it in .env.local (see .env.example).`,
    );
  }
  return v;
}

function optional(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const env = {
  NODE_ENV: (process.env.NODE_ENV ?? "development") as
    | "development"
    | "production"
    | "test",
  DATABASE_URL: required("DATABASE_URL"),
  REDIS_URL: optional("REDIS_URL", "redis://localhost:6379"),
  AUTH_SECRET: required("AUTH_SECRET"),
  NEXTAUTH_URL: optional("NEXTAUTH_URL", "http://localhost:3000"),
  SMTP_HOST: optional("SMTP_HOST"),
  SMTP_PORT: Number(optional("SMTP_PORT", "587")),
  SMTP_USER: optional("SMTP_USER"),
  SMTP_PASS: optional("SMTP_PASS"),
  SMTP_FROM: optional("SMTP_FROM", "RestoreField <noreply@localhost>"),
  S3_ENDPOINT: optional("S3_ENDPOINT"),
  S3_REGION: optional("S3_REGION", "us-east-1"),
  S3_ACCESS_KEY: optional("S3_ACCESS_KEY"),
  S3_SECRET_KEY: optional("S3_SECRET_KEY"),
  S3_BUCKET: optional("S3_BUCKET", "restorefield"),
  S3_FORCE_PATH_STYLE: optional("S3_FORCE_PATH_STYLE", "true") === "true",
  LOG_LEVEL: optional("LOG_LEVEL", "info"),
} as const;
