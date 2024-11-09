/*
https://docs.nestjs.com/modules
*/

import { Module } from '@nestjs/common';
import { CloudStorageCacheService } from './cloudstorage-cache.service';
import { GcsService } from '../gcs/gcs.service';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [ConfigModule],
    controllers: [],
    providers: [CloudStorageCacheService, GcsService],
    exports: [CloudStorageCacheService]
})
export class CloudstorageCacheModule {}
