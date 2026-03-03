import { Module } from '@nestjs/common';
import { DivisionsController } from './divisions.controller';
import { DivisionsService } from './divisions.service';
import { BigQueryService } from '../bigquery/bigquery.service';
import { AppCacheModule } from '../cache/cache.module';

@Module({
    imports: [AppCacheModule],
    controllers: [DivisionsController],
    providers: [DivisionsService, BigQueryService],
})
export class DivisionsModule { }
