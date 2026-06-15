import { buildUsageRow } from './usage.row';
import { UsageStore } from './usage.context';

function mockReq(overrides: any = {}): any {
  return {
    method: 'GET',
    originalUrl: '/places?lat=40.7&lng=-74',
    url: '/places?lat=40.7&lng=-74',
    headers: {},
    query: { lat: '40.7', lng: '-74' },
    route: { path: '/places' },
    ...overrides,
  };
}

function mockRes(overrides: any = {}): any {
  return {
    statusCode: 200,
    locals: { user: { accountId: 'acc-1', userId: 'usr-1', isDemoAccount: false } },
    getHeader: () => undefined,
    ...overrides,
  };
}

function store(jobs: any[] = []): UsageStore {
  return { requestId: 'req-uuid', startTime: Date.now() - 25, jobs };
}

describe('buildUsageRow', () => {
  it('maps request, user, and summed job cost', () => {
    const row = buildUsageRow(
      mockReq(),
      mockRes({ getHeader: (h: string) => (h === 'X-Total-Count' ? '3' : undefined) }),
      store([
        { jobId: 'j1', bytesProcessed: 100, bytesBilled: 200, costUsd: 0.001, durationMs: 10, statementType: 'SELECT' },
        { jobId: 'j2', bytesProcessed: 50, bytesBilled: 80, costUsd: 0.0004, durationMs: 5, statementType: 'SELECT' },
      ]),
    );

    expect(row.request_id).toBe('req-uuid');
    expect(row.account_id).toBe('acc-1');
    expect(row.route).toBe('/places');
    expect(row.bq_job_count).toBe(2);
    expect(row.total_bytes_billed).toBe(280);
    expect(row.cost_usd).toBeCloseTo(0.0014);
    expect(row.response_count).toBe(3);
    expect(row.cache_hit).toBe(false);
    expect(row.jobs).toHaveLength(2);
    expect(row.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('flags a successful data-route request with no jobs as a cache hit', () => {
    const row = buildUsageRow(mockReq(), mockRes(), store([]));
    expect(row.cache_hit).toBe(true);
  });

  it('does not flag the non-data root route as a cache hit', () => {
    const row = buildUsageRow(
      mockReq({ originalUrl: '/', url: '/', route: { path: '/' } }),
      mockRes(),
      store([]),
    );
    expect(row.cache_hit).toBe(false);
  });

  it('hashes the api key rather than storing it, and never stores the raw key', () => {
    const row = buildUsageRow(
      mockReq({ headers: { 'x-api-key': 'super-secret-key' } }),
      mockRes(),
      store([]),
    );
    expect(row.api_key_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain('super-secret-key');
  });

  it('records anonymous requests with null account and the status code', () => {
    const row = buildUsageRow(
      mockReq(),
      mockRes({ statusCode: 401, locals: {} }),
      store([]),
    );
    expect(row.account_id).toBeNull();
    expect(row.is_demo).toBe(false);
    expect(row.status_code).toBe(401);
    expect(row.cache_hit).toBe(false); // not a success
  });
});
