import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration for the target normalized schema.
 *
 * DATABASE_URL is read from the process environment; no credentials are stored
 * here. The placeholder below is safe for offline `drizzle-kit generate` only.
 * It must NEVER be used to connect to a real database. No migration was run in
 * this repository phase.
 */
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/saha_placeholder';

export default defineConfig({
  dialect: 'postgresql',
  schema: './apps/api/src/db/schema.ts',
  out: './apps/api/migrations',
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
