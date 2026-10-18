import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { Request, Response } from 'express';
import { User } from '../decorators/authed-user.decorator';
import { PlanLookupService } from '../tiers/plan-lookup.service';
import { resolveQuotaPolicy } from './plan-limits';
import { QuotaNoticeService } from './quota-notices';
import { nextMonthStartUtc, UsageCounterStore } from './usage-counter.store';
import { PRICING_URL } from '../common/links';

// Monthly request cap per account, enforced inside the API with no call to
// TheAuthAPI (etl/bigquery-cost-controls.md, section 9).
//
// Limits come from the Stripe plan (quota/plan-limits.ts): requests between
// the advertised allowance and the soft limit work but carry X-Quota-Warning;
// at the soft limit they are refused with 429 until 00:00 UTC on the 1st.
// Applies to paid plans too, at their own soft limit.
//
// What counts: authenticated, non-demo requests that complete with a status
// below 400. Auth failures, validation errors, the paid-only 403, and every
// 429 (this guard's or the per-minute throttler's) are never charged.
//
// QUOTA_MODE: `enforce` (default) blocks; `log` counts, sets headers and logs
// what it would have blocked; `off` does nothing.
//
// Passing the allowance and reaching the limit each trigger one email to the
// account's team per month (QUOTA_NOTICE_MODE, quota/quota-notices.ts).
//
// Fails open everywhere: unknown plan, counter unavailable, or any error in
// this guard lets the request through.

const fmt = (n: number) => n.toLocaleString('en-GB');

export function quotaMode(): 'enforce' | 'log' | 'off' {
  const m = (process.env.QUOTA_MODE || 'enforce').toLowerCase();
  return m === 'log' || m === 'off' ? m : 'enforce';
}

export function quotaExceededMessage(plan: string, used: number, allowance: number, hardLimit: number, resetAt: Date): string {
  const reset = resetAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    `Monthly request limit reached: this account has made ${fmt(used)} requests this month on the ${plan} plan ` +
    `(allowance ${fmt(allowance)}, limit ${fmt(hardLimit)}). It resets at 00:00 UTC on ${reset}. ` +
    `Upgrade for a higher limit: ${PRICING_URL}`
  );
}

@Injectable()
export class MonthlyQuotaGuard implements CanActivate {
  private readonly logger = new Logger('MonthlyQuotaGuard');

  constructor(
    private readonly plans: PlanLookupService,
    private readonly counter: UsageCounterStore,
    @Optional() private readonly notices?: QuotaNoticeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const mode = quotaMode();
    if (mode === 'off') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const user = ((req as any)['user'] || res.locals?.user) as User | undefined;
    if (!user?.accountId || user.isDemoAccount) return true;
    // Push out increments from earlier requests while this one has CPU.
    this.counter.flushSoon();

    let decision: { block: boolean; message?: string; retryAfter?: number } = { block: false };
    try {
      const plan = user.isPaidAccount ? { status: 'paid' as const } : await this.plans.getPlan(user.accountId);
      const policy = resolveQuotaPolicy(user, plan);

      // Charge the request once it has completed successfully, never before.
      res.on('finish', () => {
        if (res.statusCode < 400) this.counter.record(user.accountId);
      });

      if (policy.kind === 'unlimited') return true;

      const now = new Date();
      const used = await this.counter.current(user.accountId, now);
      if (used === null) return true;

      const { plan: planName, allowance, hardLimit } = policy.limits;
      const resetAt = nextMonthStartUtc(now);
      res.setHeader('X-Quota-Plan', planName);
      res.setHeader('X-Quota-Limit', String(allowance));
      res.setHeader('X-Quota-Hard-Limit', String(hardLimit));
      res.setHeader('X-Quota-Used', String(used));
      res.setHeader('X-Quota-Remaining', String(Math.max(0, allowance - used)));
      res.setHeader('X-Quota-Reset', String(Math.floor(resetAt.getTime() / 1000)));
      if (used >= allowance) {
        res.setHeader(
          'X-Quota-Warning',
          `Over the ${fmt(allowance)} requests/month included in the ${planName} plan; requests are refused from ${fmt(hardLimit)}.`,
        );
      }
      // Email the team once when they pass the allowance and once when
      // requests start being refused (quota/quota-notices.ts). Not for manual
      // overrides: whoever set one is already talking to the account.
      const override = 'override' in plan ? plan.override : undefined;
      const overridden = !!override && override.until.getTime() > now.getTime();
      if (used >= allowance && this.notices && !overridden) {
        await this.notices.notify({ accountId: user.accountId, plan: planName, used, allowance, hardLimit, now });
      }
      if (used >= hardLimit) {
        const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
        const message = quotaExceededMessage(planName, used, allowance, hardLimit, resetAt);
        if (mode === 'enforce') {
          decision = { block: true, message, retryAfter };
        } else {
          this.logger.warn(`[log mode] would block account ${user.accountId}: ${used}/${hardLimit} on ${planName}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Monthly quota check failed for account ${user.accountId}: ${err?.message ?? err}; allowing.`);
      return true;
    }

    if (decision.block) {
      res.setHeader('Retry-After', String(decision.retryAfter));
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'monthly_quota_exceeded', message: decision.message },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
