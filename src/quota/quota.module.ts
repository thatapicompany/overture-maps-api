import { Global, Module } from '@nestjs/common';
import { UsageCounterStore } from './usage-counter.store';
import { MonthlyQuotaGuard } from './monthly-quota.guard';
import { QuotaNoticeService } from './quota-notices';

@Global()
@Module({
  providers: [UsageCounterStore, QuotaNoticeService, MonthlyQuotaGuard],
  exports: [UsageCounterStore, QuotaNoticeService, MonthlyQuotaGuard],
})
export class QuotaModule {}
