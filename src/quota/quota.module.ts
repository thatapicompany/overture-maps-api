import { Global, Module } from '@nestjs/common';
import { UsageCounterStore } from './usage-counter.store';
import { MonthlyQuotaGuard } from './monthly-quota.guard';

@Global()
@Module({
  providers: [UsageCounterStore, MonthlyQuotaGuard],
  exports: [UsageCounterStore, MonthlyQuotaGuard],
})
export class QuotaModule {}
