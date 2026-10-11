import { CounterBackend, monthKey, nextMonthStartUtc, UsageCounterStore } from './usage-counter.store';

function memoryBackend() {
  const docs = new Map<string, number>();
  const backend: CounterBackend & { docs: Map<string, number> } = {
    docs,
    read: jest.fn(async (k: string) => (docs.has(k) ? docs.get(k)! : null)),
    create: jest.fn(async (k: string, d: { count: number }) => {
      if (docs.has(k)) return false;
      docs.set(k, d.count);
      return true;
    }),
    increment: jest.fn(async (k: string, n: number) => {
      docs.set(k, (docs.get(k) ?? 0) + n);
    }),
  };
  return backend;
}

const OCT = new Date('2026-10-11T05:00:00Z');

describe('UsageCounterStore', () => {
  it('seeds a new account-month from BigQuery so a mid-month launch counts from the 1st', async () => {
    const store = new UsageCounterStore();
    const backend = memoryBackend();
    const seeder = jest.fn().mockResolvedValue(320);
    store.configure(backend, seeder);
    expect(await store.current('acct', OCT)).toBe(320);
    expect(seeder).toHaveBeenCalledWith('acct', new Date('2026-10-01T00:00:00Z'));
    expect(backend.docs.get('acct_2026-10')).toBe(320);
  });

  it('does not re-seed when another instance already created the doc', async () => {
    const store = new UsageCounterStore();
    const backend = memoryBackend();
    backend.docs.set('acct_2026-10', 57);
    const seeder = jest.fn().mockResolvedValue(999);
    store.configure(backend, seeder);
    expect(await store.current('acct', OCT)).toBe(57);
    expect(seeder).not.toHaveBeenCalled();
  });

  it('counts recorded requests immediately and batches them into one Firestore increment', async () => {
    const store = new UsageCounterStore();
    const backend = memoryBackend();
    store.configure(backend, jest.fn().mockResolvedValue(10));
    await store.current('acct', OCT);
    for (let i = 0; i < 5; i++) store.record('acct', OCT);
    expect(await store.current('acct', OCT)).toBe(15);
    await store.flush();
    expect(backend.increment).toHaveBeenCalledTimes(1);
    expect(backend.increment).toHaveBeenCalledWith('acct_2026-10', 5);
    expect(backend.docs.get('acct_2026-10')).toBe(15);
    expect(await store.current('acct', OCT)).toBe(15); // not double counted after flush
  });

  it('sees other instances\' flushed increments on refresh without double counting its own', async () => {
    const prev = process.env.QUOTA_COUNT_REFRESH_MS;
    process.env.QUOTA_COUNT_REFRESH_MS = '0';
    try {
      const store = new UsageCounterStore();
      const backend = memoryBackend();
      store.configure(backend, jest.fn().mockResolvedValue(0));
      await store.current('acct', OCT);
      store.record('acct', OCT);
      store.record('acct', OCT);
      await store.flush(); // ours: +2
      backend.docs.set('acct_2026-10', backend.docs.get('acct_2026-10')! + 30); // another instance: +30
      await store.current('acct', OCT); // triggers background refresh
      await new Promise((r) => setImmediate(r));
      expect(await store.current('acct', OCT)).toBe(32);
    } finally {
      if (prev === undefined) delete process.env.QUOTA_COUNT_REFRESH_MS; else process.env.QUOTA_COUNT_REFRESH_MS = prev;
    }
  });

  it('returns null (caller allows) when Firestore or BigQuery fails, and backs off before retrying', async () => {
    const store = new UsageCounterStore();
    (store as any).logger = { log: jest.fn(), error: jest.fn() };
    const backend = memoryBackend();
    (backend.read as jest.Mock).mockRejectedValue(new Error('PERMISSION_DENIED'));
    store.configure(backend, jest.fn());
    expect(await store.current('acct', OCT)).toBeNull();
    expect(await store.current('acct', OCT)).toBeNull();
    expect(backend.read).toHaveBeenCalledTimes(1); // backed off
  });

  it('never retries an increment that timed out after landing (the production double count)', async () => {
    const prev = process.env.QUOTA_WRITE_TIMEOUT_MS;
    const prevStore = process.env.QUOTA_STORE_TIMEOUT_MS;
    process.env.QUOTA_WRITE_TIMEOUT_MS = '20';
    process.env.QUOTA_STORE_TIMEOUT_MS = '20';
    try {
      const store = new UsageCounterStore();
      (store as any).logger = { log: jest.fn(), error: jest.fn() };
      const backend = memoryBackend();
      store.configure(backend, jest.fn().mockResolvedValue(3));
      await store.current('acct', OCT);
      // The write lands immediately but the acknowledgement is slower than the timeout.
      (backend.increment as jest.Mock).mockImplementation(async (k: string, n: number) => {
        backend.docs.set(k, (backend.docs.get(k) ?? 0) + n);
        await new Promise((r) => setTimeout(r, 100));
      });
      for (let i = 0; i < 2; i++) {
        store.record('acct', OCT);
        await store.flush();
      }
      await store.flush();
      await new Promise((r) => setTimeout(r, 150));
      expect(backend.docs.get('acct_2026-10')).toBe(5); // 3 seeded + 2, not 7 or 8
      expect(backend.increment).toHaveBeenCalledTimes(2);
    } finally {
      if (prev === undefined) delete process.env.QUOTA_WRITE_TIMEOUT_MS; else process.env.QUOTA_WRITE_TIMEOUT_MS = prev;
      if (prevStore === undefined) delete process.env.QUOTA_STORE_TIMEOUT_MS; else process.env.QUOTA_STORE_TIMEOUT_MS = prevStore;
    }
  });

  it('does not retry a failed increment either, and re-syncs from Firestore on the next read', async () => {
    const store = new UsageCounterStore();
    (store as any).logger = { log: jest.fn(), error: jest.fn() };
    const backend = memoryBackend();
    store.configure(backend, jest.fn().mockResolvedValue(0));
    await store.current('acct', OCT);
    store.record('acct', OCT);
    (backend.increment as jest.Mock).mockRejectedValueOnce(new Error('UNAVAILABLE'));
    await store.flush();
    await store.flush();
    expect(backend.increment).toHaveBeenCalledTimes(1);
    await store.current('acct', OCT); // forced refresh
    await new Promise((r) => setImmediate(r));
    expect(await store.current('acct', OCT)).toBe(0); // the write did not land, and nothing pretends it did
  });

  it('flushSoon starts a flush only when something is pending', async () => {
    const store = new UsageCounterStore();
    const backend = memoryBackend();
    store.configure(backend, jest.fn().mockResolvedValue(0));
    await store.current('acct', OCT);
    store.flushSoon();
    await new Promise((r) => setImmediate(r));
    expect(backend.increment).not.toHaveBeenCalled();
    store.record('acct', OCT);
    store.flushSoon();
    await new Promise((r) => setImmediate(r));
    expect(backend.increment).toHaveBeenCalledWith('acct_2026-10', 1);
  });

  it('starts a new count each UTC month', async () => {
    const store = new UsageCounterStore();
    const backend = memoryBackend();
    backend.docs.set('acct_2026-10', 199);
    store.configure(backend, jest.fn().mockResolvedValue(0));
    expect(await store.current('acct', new Date('2026-10-31T23:59:59Z'))).toBe(199);
    expect(await store.current('acct', new Date('2026-11-01T00:00:00Z'))).toBe(0);
    expect(monthKey(new Date('2026-12-31T23:00:00Z'))).toBe('2026-12');
    expect(nextMonthStartUtc(new Date('2026-12-31T23:00:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
