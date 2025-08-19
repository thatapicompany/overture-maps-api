import { Logger } from '@nestjs/common';
import { EnrichmentAdapter } from './EnrichmentAdapter';
import { OpenSourceEnrichmentAdapter } from './OpenSourceEnrichmentAdapter';

// Loader that selects the enrichment adapter at runtime. A PgEnrichmentAdapter can
// be plugged in via ENRICHMENT_ADAPTER_PACKAGE in the future.
export function loadEnrichmentAdapter(): EnrichmentAdapter {
  const logger = new Logger('EnrichmentAdapterLoader');

  try {
    if (process.env.ENABLE_ENRICHMENT !== 'true') {
      return new OpenSourceEnrichmentAdapter();
    }

    if (process.env.ENRICHMENT_ADAPTER_PACKAGE) {
      const pkg = require(process.env.ENRICHMENT_ADAPTER_PACKAGE);
      const Adapter = pkg.default || pkg;
      return new Adapter();
    }

    // Default to built-in BigQuery adapter
    const { BqEnrichmentAdapter } = require('../bq-enrichment/BqEnrichmentAdapter');
    return new BqEnrichmentAdapter();
  } catch (err: any) {
    logger.warn(`Failed to load enrichment adapter: ${err.message}`);
    return new OpenSourceEnrichmentAdapter();
  }
}
