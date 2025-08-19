import { EnrichmentAdapter } from './EnrichmentAdapter';

export class OpenSourceEnrichmentAdapter implements EnrichmentAdapter {
  async fetchEnrichmentByIds(
    ids: string[],
    options?: { fields?: string[] }
  ): Promise<Record<string, Record<string, unknown>>> {
    return {};
  }

  async supportedFields(): Promise<string[]> {
    return [];
  }
}
