import { Module } from '@nestjs/common';
import { DivisionsController } from './divisions.controller';
import { DivisionsService } from './divisions.service';
import { DivisionsSearchIndexService } from './divisions-search-index.service';
import { BigQueryService } from '../bigquery/bigquery.service';
import { GcsService } from '../gcs/gcs.service';
import { AppCacheModule } from '../cache/cache.module';

@Module({
    imports: [AppCacheModule],
    controllers: [DivisionsController],
    providers: [DivisionsService, DivisionsSearchIndexService, BigQueryService, GcsService],
})
export class DivisionsModule { }
