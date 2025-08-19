export interface EnrichmentAdapter {
  /**
   * Fetch enrichment data for a set of place IDs.
   * A future PgEnrichmentAdapter can be injected via ENRICHMENT_ADAPTER_PACKAGE without API changes.
   */
  fetchEnrichmentByIds(
    ids: string[],
    options?: { fields?: string[] }
  ): Promise<Record<string, Record<string, unknown>>>;

  /**
   * List supported enrichment fields.
   */
  supportedFields(): Promise<string[]>;
}
