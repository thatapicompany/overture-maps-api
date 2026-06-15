import { Module } from '@nestjs/common';
import { UsageSink } from './usage.sink';

@Module({
  providers: [UsageSink],
  exports: [UsageSink],
})
export class UsageModule {}
