import { Inject, Injectable, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Bucket } from '@google-cloud/storage';
import { CACHE_CONFIG, GCS_BUCKET, CacheConfig } from './cache.module';

@Injectable()
export class CacheService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Inject(CACHE_CONFIG) private config: CacheConfig,
    @Optional() @Inject(GCS_BUCKET) private bucket?: Bucket | null,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const entry = await this.cacheManager.get<any>(key);
    if (!entry) {
      return undefined;
    }
    if (entry?.gcs && this.bucket) {
      const [data] = await this.bucket.file(key).download();
      return JSON.parse(data.toString()) as T;
    }
    return entry as T;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    const byteLength = Buffer.byteLength(serialized);
    const canUseCache =
      !!this.config.redisUrl && byteLength <= this.config.maxObjectBytes;

    if (canUseCache) {
      await this.cacheManager.set(key, value, ttl);
      return;
    }

    if (this.bucket) {
      await this.bucket.file(key).save(serialized, { resumable: false });
      await this.cacheManager.set(key, { gcs: true }, ttl);
      return;
    }

    await this.cacheManager.set(key, value, ttl);
  }

  async del(key: string): Promise<void> {
    const entry = await this.cacheManager.get<any>(key);
    await this.cacheManager.del(key);
    if (entry?.gcs && this.bucket) {
      try {
        await this.bucket.file(key).delete();
      } catch {}
    }
  }
}
