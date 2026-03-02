import { Module } from '@nestjs/common';
import { BaseController } from './base.controller';
import { BaseService } from './base.service';
import { BigQueryService } from '../bigquery/bigquery.service';
import { AppCacheModule } from '../cache/cache.module';

@Module({
    imports: [AppCacheModule],
    controllers: [BaseController],
    providers: [BaseService, BigQueryService],
})
export class BaseModule { }
