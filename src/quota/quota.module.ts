import { Global, Module } from '@nestjs/common';
import { UsageCounterStore } from './usage-counter.store';
import { MonthlyQuotaGuard } from './monthly-quota.guard';
import { QuotaEventPublisher } from './quota-events';

@Global()
@Module({
  providers: [UsageCounterStore, QuotaEventPublisher, MonthlyQuotaGuard],
  exports: [UsageCounterStore, QuotaEventPublisher, MonthlyQuotaGuard],
})
export class QuotaModule {}
