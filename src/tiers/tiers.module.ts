import { Global, Module } from '@nestjs/common';
import { PlanLookupService } from './plan-lookup.service';

// Global so the places gate and the monthly quota guard share one plan cache.
@Global()
@Module({
  providers: [PlanLookupService],
  exports: [PlanLookupService],
})
export class TiersModule {}
