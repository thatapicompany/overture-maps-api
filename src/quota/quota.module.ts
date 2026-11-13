import { Global, Module } from '@nestjs/common';
import { UsageCounterStore } from './usage-counter.store';
import { MonthlyQuotaGuard } from './monthly-quota.guard';
import { QuotaNoticeService } from './quota-notices';
import { QuotaEventPublisher } from './quota-events';

@Global()
@Module({
  providers: [UsageCounterStore, QuotaNoticeService, QuotaEventPublisher, MonthlyQuotaGuard],
  exports: [UsageCounterStore, QuotaNoticeService, QuotaEventPublisher, MonthlyQuotaGuard],
})
export class QuotaModule {}
