import { BuildingsService } from './buildings.service';
import { BuildingsController } from './buildings.controller';
import { BigQueryService } from '../bigquery/bigquery.service';
import { GcsService } from '../gcs/gcs.service';
import { ConfigModule } from '@nestjs/config';
/*
https://docs.nestjs.com/modules
*/

import { Module } from '@nestjs/common';
import { CloudstorageCacheModule } from '../cloudstorage-cache/cloudstorage-cache.module';

@Module({
    imports: [ConfigModule, CloudstorageCacheModule],
    controllers: [
        BuildingsController],
    providers: [
        BuildingsService, BigQueryService, GcsService],
    exports: [BuildingsService]
})
export class BuildingsModule { }
