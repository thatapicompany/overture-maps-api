import { BrandsEnrichmentService } from './brands-enrichment.service';

describe('BrandsEnrichmentService', () => {
  const ndjson = [
    JSON.stringify({ qid: 'Q37158', label: 'Starbucks', logo_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Starbucks%20coffee%20wordmark.png', website: 'https://www.starbucks.com/', industry: 'coffee industry', updated_at: '2026-07-08T00:00:00Z' }),
    JSON.stringify({ qid: 'Q861042', label: 'Western Union', website: 'https://www.westernunion.com', industry: 'financial services' }),
    '',
  ].join('\n');

  const service = () => new BrandsEnrichmentService({} as any);

  it('loads NDJSON and serves lookups by QID', () => {
    const s = service();
    expect(s.isReady()).toBe(false);

    s.loadFromNdjson(ndjson);

    expect(s.isReady()).toBe(true);
    expect(s.size()).toBe(2);
    expect(s.get('Q37158')?.label).toBe('Starbucks');
    expect(s.get('Q37158')?.logo_url).toContain('commons.wikimedia.org');
    expect(s.get('Q861042')?.logo_url).toBeUndefined();
  });

  it('returns undefined for unknown or missing QIDs', () => {
    const s = service();
    s.loadFromNdjson(ndjson);

    expect(s.get('Q999999999')).toBeUndefined();
    expect(s.get(undefined)).toBeUndefined();
    expect(s.get(null)).toBeUndefined();
  });

  it('replaces (not merges) data on reload', () => {
    const s = service();
    s.loadFromNdjson(ndjson);
    s.loadFromNdjson(JSON.stringify({ qid: 'Q1', label: 'Only Brand' }));

    expect(s.size()).toBe(1);
    expect(s.get('Q37158')).toBeUndefined();
  });
});
