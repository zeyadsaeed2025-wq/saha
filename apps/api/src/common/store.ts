import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { emptyState, type DbState } from '../domain/types.js';
import { createPostgresStore } from './postgres-store.js';

export interface Store {
  kind: 'local-json' | 'postgres' | 'memory';
  read<T>(fn: (state: DbState) => T): T;
  mutate<T>(fn: (draft: DbState) => T): Promise<T>;
  reset(): void;
  readonly file: string | null;
}

/**
 * Local development / demonstration adapter.
 * Serialized, transactional mutations over a deep-cloned draft with atomic
 * JSON persistence. Presence is deliberately NOT persisted here: it lives in
 * the in-memory world registry (ADR-002).
 */
export function createStore(file: string | null = null): Store {
  let state: DbState = load(file);
  let queue: Promise<unknown> = Promise.resolve();

  function load(path: string | null): DbState {
    if (!path) return emptyState();
    const full = resolve(path);
    if (!existsSync(full)) return emptyState();
    try {
      const parsed = JSON.parse(readFileSync(full, 'utf8')) as Partial<DbState>;
      return { ...emptyState(), ...parsed };
    } catch (error) {
      // Fail closed: never silently replace a customer's data with an empty store.
      throw new Error(`Unable to read data file ${full}: ${(error as Error).message}`);
    }
  }

  function persist(next: DbState): void {
    if (!file) return;
    const full = resolve(file);
    mkdirSync(dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
    const handle = writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    void handle;
    renameSync(tmp, full);
  }

  return {
    kind: file ? 'local-json' : 'memory',
    file,
    read: (fn) => fn(structuredClone(state)),
    mutate: (fn) => {
      const run = async (): Promise<unknown> => {
        const draft = structuredClone(state);
        const result = await fn(draft);
        persist(draft);
        state = draft;
        return result;
      };
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next as Promise<never>;
    },
    reset: () => {
      state = emptyState();
      persist(state);
    },
  };
}

export let store: Store = createStore(
  process.env.DATA_ADAPTER === 'postgres'
    ? null
    : process.env.LOCAL_DATA_FILE ?? './data/store.json',
);

/** Must be awaited before the HTTP server starts when DATA_ADAPTER=postgres. */
export async function initializeStore(): Promise<void> {
  if (process.env.DATA_ADAPTER !== 'postgres') return;
  store = await createPostgresStore(process.env.DATABASE_URL ?? '');
}

/** Entity lookup helpers — all tenant-scoped lookups go through these. */
export const inOrg = <T extends { organizationId: string }>(items: T[], orgId: string): T[] =>
  items.filter((item) => item.organizationId === orgId);

export const findInOrg = <T extends { organizationId: string; id: string }>(
  items: T[], orgId: string, id: string,
): T | undefined => items.find((item) => item.id === id && item.organizationId === orgId);
