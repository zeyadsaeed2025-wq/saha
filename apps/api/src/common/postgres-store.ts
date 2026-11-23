import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { emptyState, type DbState } from '../domain/types.js';
import type { Store } from './store.js';

const { Pool } = pg;
const STATE_ID = 'saha-main';

/**
 * Durable PostgreSQL adapter. It keeps a normalized-compatible JSONB document
 * behind a transactional boundary so the existing repository callbacks keep
 * their atomicity without duplicating business logic.
 *
 * ADR-002 still applies to in-memory presence. Multi-process writes are safe
 * because every mutation runs `SELECT ... FOR UPDATE` in one transaction, but
 * `read()` serves the last committed snapshot from this process; the world
 * server remains single-instance by design.
 */
export async function createPostgresStore(connectionString: string): Promise<Store & { close: () => Promise<void> }> {
  if (!connectionString) throw new Error('DATABASE_URL is required for DATA_ADAPTER=postgres');
  const pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 5),
    ssl: process.env.PGSSLMODE === 'disable' ? undefined : { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS saha_state (
        id TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query('INSERT INTO saha_state (id, state) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING', [STATE_ID, JSON.stringify(emptyState())]);
  } finally {
    client.release();
  }

  let state: DbState = await load();
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<DbState> {
    const result = await pool.query<{ state: DbState }>('SELECT state FROM saha_state WHERE id = $1', [STATE_ID]);
    if (!result.rows[0]) return emptyState();
    return { ...emptyState(), ...result.rows[0].state };
  }

  const run = async (fn: (draft: DbState) => unknown): Promise<unknown> => {
    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      await tx.query('SELECT id FROM saha_state WHERE id = $1 FOR UPDATE', [STATE_ID]);
      const draft = structuredClone(state);
      const result = await fn(draft);
      await tx.query('UPDATE saha_state SET state = $2::jsonb, updated_at = now() WHERE id = $1', [STATE_ID, JSON.stringify(draft)]);
      await tx.query('COMMIT');
      state = draft;
      return result;
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally {
      tx.release();
    }
  };

  return {
    kind: 'postgres',
    file: null,
    read: (fn) => fn(structuredClone(state)),
    mutate: (fn) => {
      const next = queue.then(() => run(fn), () => run(fn));
      queue = next.catch(() => undefined);
      return next as Promise<never>;
    },
    reset: () => {
      throw new Error('reset() is disabled for the PostgreSQL adapter');
    },
    close: () => pool.end(),
  };
}

/** Generates an opaque ticket identifier used by short-lived WS tickets. */
export const newTicketId = (): string => randomUUID();
