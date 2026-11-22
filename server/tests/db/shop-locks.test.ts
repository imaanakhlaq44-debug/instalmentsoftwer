import { describe, it, expect, afterAll, vi } from 'vitest';

// Two transactions at once need two connections; the test default is one.
// Runs before the imports below, so this file gets its own, larger pool.
vi.hoisted(() => {
  process.env.DB_POOL_MAX = '4';
  delete (globalThis as { __emiPrisma?: unknown }).__emiPrisma;
});

import { runInTransaction, runInShopTransaction, disconnectDatabase } from '../../src/db/prisma.js';

afterAll(async () => {
  await disconnectDatabase();
});

/**
 * The write locks behind runInTransaction.
 *
 * Each case starts a transaction that holds its lock until released, then
 * checks whether a second one has to wait for it.
 */

function holder(start: (fn: () => Promise<void>) => Promise<unknown>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let entered!: () => void;
  const inside = new Promise<void>((r) => (entered = r));
  const done = start(async () => {
    entered();
    await gate;
  });
  return { inside, release, done };
}

/** Resolves true if `p` settles within `ms`. */
async function settlesWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
}

describe('shop write locks', () => {
  it('lets two different shops write at the same time', async () => {
    const a = holder((fn) => runInShopTransaction('dealer-1', fn));
    await a.inside;
    const b = runInShopTransaction('dealer-2', async () => 'b');
    expect(await settlesWithin(b, 3000)).toBe(true);
    a.release();
    await a.done;
  });

  it('makes writes in the same shop take turns', async () => {
    const a = holder((fn) => runInShopTransaction('dealer-1', fn));
    await a.inside;
    const b = runInShopTransaction('dealer-1', async () => 'b');
    expect(await settlesWithin(b, 700)).toBe(false);
    a.release();
    await a.done;
    expect(await b).toBe('b');
  });

  it('a platform-wide write waits for shop writes, and they wait for it', async () => {
    const shop = holder((fn) => runInShopTransaction('dealer-1', fn));
    await shop.inside;
    const global = runInTransaction(async () => 'global');
    expect(await settlesWithin(global, 700)).toBe(false);
    shop.release();
    await shop.done;
    expect(await global).toBe('global');

    const g = holder((fn) => runInTransaction(fn));
    await g.inside;
    const other = runInShopTransaction('dealer-2', async () => 'other');
    expect(await settlesWithin(other, 700)).toBe(false);
    g.release();
    await g.done;
    expect(await other).toBe('other');
  });

  it('refuses a shop transaction without a shop', async () => {
    expect(() => runInShopTransaction('', async () => 1)).toThrow();
  });
});
