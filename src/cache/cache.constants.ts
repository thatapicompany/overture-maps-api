export interface CacheConfig {
  redisUrl?: string;
  maxObjectBytes: number;
  gcsBucket?: string;
}

export const CACHE_CONFIG = 'CACHE_CONFIG';
export const GCS_BUCKET = 'GCS_BUCKET';
