import { loadEnrichmentAdapter } from './loadEnrichmentAdapter';
import { OpenSourceEnrichmentAdapter } from './OpenSourceEnrichmentAdapter';

describe('loadEnrichmentAdapter', () => {
  it('returns OpenSourceEnrichmentAdapter when disabled', () => {
    process.env.ENABLE_ENRICHMENT = 'false';
    const adapter = loadEnrichmentAdapter();
    expect(adapter).toBeInstanceOf(OpenSourceEnrichmentAdapter);
  });
});
