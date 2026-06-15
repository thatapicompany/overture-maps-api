// Builds a stable cache key from only the parameters that affect the underlying
// BigQuery result. Presentation params (format, includes, enrichment_fields) and
// post-query filters (source) are deliberately excluded by the caller so that, e.g.
// a `json` and a `geojson` request for the same data share one cache entry.
//
// Keys are sorted and array values are order-normalised so equivalent queries map
// to the same key regardless of how the client ordered them.
export function buildCacheKey(prefix: string, parts: Record<string, unknown>): string {
  const normalized = Object.keys(parts)
    .filter((k) => parts[k] !== undefined && parts[k] !== null && parts[k] !== '')
    .sort()
    .map((k) => {
      const value = parts[k];
      const rendered = Array.isArray(value)
        ? [...value].map(String).sort().join(',')
        : String(value);
      return `${k}=${rendered}`;
    })
    .join('&');
  return `${prefix}:${normalized}`;
}

// Overture data only changes on monthly releases, so cached results can live far
// longer than the original 1h. Configurable without a redeploy; defaults to 24h.
export const CACHE_TTL_SECONDS = parseInt(process.env.CACHE_TTL_SECONDS || '86400', 10);
