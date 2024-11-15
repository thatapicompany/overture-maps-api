/*
https://docs.nestjs.com/modules
*/

import { Module } from '@nestjs/common';
import { PlacesService } from './places.service';
import { PlacesController } from './places.controller';
import { BigQueryService } from '../bigquery/bigquery.service';
import { GcsService } from '../gcs/gcs.service';
import { ConfigModule } from '@nestjs/config';
import { CloudstorageCacheModule } from '../cloudstorage-cache/cloudstorage-cache.module';
import { BuildingsModule } from '../buildings/buildings.module';

@Module({
    imports: [ConfigModule, CloudstorageCacheModule, BuildingsModule],
    controllers: [PlacesController],
    providers: [PlacesService, BigQueryService, GcsService],
    exports: [PlacesService]

})
export class PlacesModule {}
