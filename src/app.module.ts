// src/app.module.ts
import { Module } from '@nestjs/common';
import { PlacesController } from './places/places.controller';
import { BigQueryService } from './bigquery/bigquery.service';
import { GcsService } from './gcs/gcs.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [PlacesController],
  providers: [BigQueryService, GcsService],
})
export class AppModule {}
