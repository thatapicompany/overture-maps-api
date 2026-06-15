import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { usageStorage, UsageStore } from './usage.context';
import { buildUsageRow } from './usage.row';
import { UsageSink } from './usage.sink';

/**
 * Establishes the per-request usage context and records one immutable usage row
 * when the response finishes. Applied first so the AsyncLocalStorage context is
 * active for the entire downstream pipeline (auth, controllers, BigQueryService).
 */
@Injectable()
export class UsageTrackingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('UsageTrackingMiddleware');

  constructor(private readonly sink: UsageSink) {}

  use(req: Request, res: Response, next: () => void): void {
    const store: UsageStore = {
      requestId: randomUUID(),
      startTime: Date.now(),
      jobs: [],
    };

    usageStorage.run(store, () => {
      // 'finish' fires once the response has been fully sent, for success and error
      // responses alike. The store is captured by closure, so we don't rely on the
      // ALS context still being active inside this callback.
      res.on('finish', () => {
        try {
          this.sink.enqueue(buildUsageRow(req, res, store));
        } catch (err: any) {
          this.logger.warn(`Failed to record usage: ${err.message}`);
        }
      });
      next();
    });
  }
}
