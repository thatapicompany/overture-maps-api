import { Module } from '@nestjs/common';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';
import { BigQueryService } from '../bigquery/bigquery.service';
import { AppCacheModule } from '../cache/cache.module';

@Module({
    imports: [AppCacheModule],
    controllers: [AddressesController],
    providers: [AddressesService, BigQueryService],
})
export class AddressesModule { }
