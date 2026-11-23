import { describe, expect, it } from 'vitest';
import { createStore } from '../common/store.js';
import type { User } from '../domain/types.js';

// The local in-memory store (createStore(null)) is under test here. No file is
// written and no PostgreSQL adapter/database is involved in these assertions.
const user = (id: string): User => ({
  id,
  phone: `+1000000000${id}`,
  name: id,
  passwordHash: 'unused',
  status: 'active',
  verifiedAt: null,
  createdAt: '2026-03-02T00:00:00.000Z',
});

describe('local store transactions (in-memory; not PostgreSQL)', () => {
  it('keeps state unchanged when a mutation throws and still accepts later mutations', async () => {
    const store = createStore(null);
    expect(store.file).toBeNull();

    await expect(store.mutate((draft) => {
      draft.users.push(user('rolled-back'));
      throw new Error('boom');
    })).rejects.toThrow('boom');

    expect(store.read((state) => state.users)).toEqual([]);

    const added = await store.mutate((draft) => {
      draft.users.push(user('committed'));
      return draft.users.length;
    });
    expect(added).toBe(1);
    expect(store.read((state) => state.users.map((u) => u.id))).toEqual(['committed']);

    store.reset();
    expect(store.read((state) => state.users)).toEqual([]);
  });

  it('serializes successful mutations so no draft changes are lost', async () => {
    const store = createStore(null);
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let lengthSeenBySecond = -1;

    const first = store.mutate(async (draft) => {
      draft.users.push(user('first'));
      await gate;
    });
    const second = store.mutate((draft) => {
      lengthSeenBySecond = draft.users.length;
      draft.users.push(user('second'));
      return draft.users.length;
    });

    // The second mutation cannot commit (or even run) until the first finishes.
    expect(store.read((state) => state.users)).toEqual([]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(lengthSeenBySecond).toBe(1);
    expect(store.read((state) => state.users.map((u) => u.id))).toEqual(['first', 'second']);
  });
});
