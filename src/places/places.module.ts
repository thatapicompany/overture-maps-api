/*
https://docs.nestjs.com/modules
*/

import { Module } from '@nestjs/common';
import { PlacesService } from './places.service';
import { PlacesController } from './places.controller';
import { BigQueryService } from '../bigquery/bigquery.service';
import { ConfigModule } from '@nestjs/config';
import { BuildingsModule } from '../buildings/buildings.module';
import { BrandsEnrichmentService } from './brands-enrichment.service';
import { GcsService } from '../gcs/gcs.service';
import { PlanLookupService } from '../tiers/plan-lookup.service';

@Module({
    imports: [ConfigModule, BuildingsModule],
    controllers: [PlacesController],
    providers: [PlacesService, BigQueryService, BrandsEnrichmentService, GcsService, PlanLookupService],
    exports: [PlacesService]

})
export class PlacesModule {}
