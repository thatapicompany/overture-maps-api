import { Module } from '@nestjs/common';
import { TransportationController } from './transportation.controller';
import { TransportationService } from './transportation.service';
import { BigQueryService } from '../bigquery/bigquery.service';
import { AppCacheModule } from '../cache/cache.module';

@Module({
    imports: [AppCacheModule],
    controllers: [TransportationController],
    providers: [TransportationService, BigQueryService],
})
export class TransportationModule { }
