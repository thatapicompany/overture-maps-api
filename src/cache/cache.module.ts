import { Module, Global } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';
import { Storage, Bucket } from '@google-cloud/storage';
import { CacheService } from './cache.service';
import { CACHE_CONFIG, GCS_BUCKET, CacheConfig } from './cache.constants';

@Global()
@Module({
  imports: [
    ConfigModule,
    NestCacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        if (redisUrl) {
          return {
            store: await redisStore({ url: redisUrl }),
          };
        }
        return {};
      },
    }),
  ],
  providers: [
    {
      provide: CACHE_CONFIG,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): CacheConfig => ({
        redisUrl: configService.get<string>('REDIS_URL'),
        maxObjectBytes: configService.get<number>(
          'CACHE_MAX_OBJECT_BYTES',
          1_000_000,
        ),
        gcsBucket: configService.get<string>('GCS_BUCKET'),
      }),
    },
    {
      provide: GCS_BUCKET,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Bucket | null => {
        const bucketName = configService.get<string>('GCS_BUCKET');
        if (bucketName) {
          const storage = new Storage();
          return storage.bucket(bucketName);
        }
        return null;
      },
    },
    CacheService,
  ],
  exports: [CacheService, CACHE_CONFIG],
})
export class AppCacheModule {}
