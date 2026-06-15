import { UsageSink } from './usage.sink';
import { UsageRow } from './usage.row';

function row(id: string): UsageRow {
  return {
    request_id: id,
    request_ts: new Date().toISOString(),
    account_id: 'acc',
    user_id: 'usr',
    is_demo: false,
    api_key_hash: null,
    method: 'GET',
    route: '/places',
    path: '/places',
    query_params: '{}',
    status_code: 200,
    cache_hit: false,
    response_count: 1,
    duration_ms: 10,
    bq_job_count: 1,
    total_bytes_billed: 100,
    cost_usd: 0.001,
    env: 'test',
    api_version: '0.1.2',
    error: null,
    jobs: [],
  };
}

describe('UsageSink', () => {
  const ORIGINAL = process.env.USAGE_TRACKING_ENABLED;
  afterEach(() => {
    process.env.USAGE_TRACKING_ENABLED = ORIGINAL;
  });

  it('is a no-op when disabled: enqueue does not throw and flush resolves', async () => {
    process.env.USAGE_TRACKING_ENABLED = 'false';
    const sink = new UsageSink();
    expect(() => sink.enqueue(row('a'))).not.toThrow();
    await expect(sink.flush()).resolves.toBeUndefined();
  });

  it('inserts buffered rows with request_id as the insertId', async () => {
    process.env.USAGE_TRACKING_ENABLED = 'true';
    const sink = new UsageSink();
    const insert = jest.fn().mockResolvedValue([{}]);
    // Inject a fake BigQuery client and mark enabled bookkeeping.
    (sink as any).bigQuery = { dataset: () => ({ table: () => ({ insert }) }) };

    sink.enqueue(row('req-1'));
    sink.enqueue(row('req-2'));
    await sink.flush();

    expect(insert).toHaveBeenCalledTimes(1);
    const [rows, opts] = insert.mock.calls[0];
    expect(opts).toEqual({ raw: true });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ insertId: 'req-1' });
    expect(rows[0].json.request_id).toBe('req-1');
  });

  it('re-buffers rows when the insert fails so usage data is not lost', async () => {
    process.env.USAGE_TRACKING_ENABLED = 'true';
    const sink = new UsageSink();
    const insert = jest.fn().mockRejectedValue(new Error('bq down'));
    (sink as any).bigQuery = { dataset: () => ({ table: () => ({ insert }) }) };

    sink.enqueue(row('req-1'));
    await sink.flush();

    expect((sink as any).buffer).toHaveLength(1);
  });
});
