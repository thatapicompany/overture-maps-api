import { CacheService } from './cache.service';
import { CacheConfig } from './cache.constants';
import { Cache } from 'cache-manager';
import { Bucket } from '@google-cloud/storage';

// simple in-memory cache mock
function createCache(): { store: Map<string, any>; cache: Cache } {
  const store = new Map<string, any>();
  const cache: Cache = {
    get: async (key: string) => store.get(key),
    set: async (key: string, value: any) => {
      store.set(key, value);
    },
    del: async (key: string) => {
      store.delete(key);
    },
  } as any;
  return { store, cache };
}

// simple GCS bucket mock
function createBucket() {
  const gcsStore = new Map<string, Buffer>();
  const bucket: Bucket = {
    file: (name: string) => ({
      save: async (data: string | Buffer) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        gcsStore.set(name, buf);
      },
      download: async () => [gcsStore.get(name) as Buffer],
      delete: async () => {
        gcsStore.delete(name);
      },
    }) as any,
  } as any;
  return { bucket, gcsStore };
}

describe('CacheService hybrid storage', () => {
  it('stores small payload in cache when redis configured', async () => {
    const { store, cache } = createCache();
    const { bucket, gcsStore } = createBucket();
    const config: CacheConfig = {
      redisUrl: 'redis://example',
      maxObjectBytes: 1000,
      gcsBucket: 'bucket',
    };
    const service = new CacheService(cache, config, bucket);
    const value = { foo: 'bar' };

    await service.set('key', value);
    expect(store.get('key')).toEqual(value);
    expect(gcsStore.size).toBe(0);
    await service.del('key');
    expect(store.has('key')).toBe(false);
  });

  it('stores large payloads in GCS when size exceeds threshold', async () => {
    const { store, cache } = createCache();
    const { bucket, gcsStore } = createBucket();
    const config: CacheConfig = {
      redisUrl: 'redis://example',
      maxObjectBytes: 10,
      gcsBucket: 'bucket',
    };
    const service = new CacheService(cache, config, bucket);
    const value = { foo: 'a'.repeat(50) };

    await service.set('key', value);
    expect(store.get('key')).toEqual({ gcs: true });
    expect(gcsStore.size).toBe(1);
    const fetched = await service.get<typeof value>('key');
    expect(fetched).toEqual(value);
    await service.del('key');
    expect(gcsStore.size).toBe(0);
  });

  it('stores payloads in GCS when redis is absent', async () => {
    const { store, cache } = createCache();
    const { bucket, gcsStore } = createBucket();
    const config: CacheConfig = {
      maxObjectBytes: 1000,
      gcsBucket: 'bucket',
    };
    const service = new CacheService(cache, config, bucket);
    const value = { foo: 'bar' };

    await service.set('key', value);
    expect(store.get('key')).toEqual({ gcs: true });
    const fetched = await service.get<typeof value>('key');
    expect(fetched).toEqual(value);
    await service.del('key');
    expect(gcsStore.size).toBe(0);
  });
});
