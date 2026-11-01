import { ExecutionContext, HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { PRICING_URL } from '../common/links';
import { User } from '../decorators/authed-user.decorator';
import { PlanLookupService } from '../tiers/plan-lookup.service';

// Per-minute rate limit, counted per account and sized by plan.
//
// The stock guard counted per IP with one limit for everyone, so a paying
// account could be throttled by its neighbours on a shared IP, and paying
// never raised the limit. Here:
// - Authenticated (non-demo) requests count against the account.
// - Demo-key and anonymous requests still count per IP: the demo account is
//   shared by every visitor, so one bucket would let one visitor block all.
// - Paid accounts get THROTTLE_LIMIT_PAID (default 120) per minute; everyone
//   else THROTTLE_LIMIT (default 60). An unknown plan gets the paid limit, in
//   line with the rest of the plan checks: uncertainty never blocks a customer.
// Keys stay per route, as before, so nobody's effective limit goes down.

export function paidMinuteLimit(): number {
  const n = parseInt(process.env.THROTTLE_LIMIT_PAID || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 120;
}

export function rateLimitedMessage(limit: number, ttlMs: number, paid: boolean): string {
  const seconds = Math.round(ttlMs / 1000);
  const window = seconds === 60 ? 'a minute' : `per ${seconds} seconds`;
  return (
    `Too many requests: this ${paid ? 'plan' : 'key'} allows ${limit} requests ${window} to each endpoint. ` +
    `Wait for the Retry-After seconds and try again${paid ? '' : `, or upgrade for a higher limit: ${PRICING_URL}`}`
  );
}

interface LimitDetail {
  limit: number;
  ttl: number;
}

function userOf(req: Record<string, any>): User | undefined {
  return (req?.user || req?.res?.locals?.user) as User | undefined;
}

@Injectable()
export class AccountThrottlerGuard extends ThrottlerGuard {
  private readonly log = new Logger('AccountThrottlerGuard');

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    @Optional() private readonly plans?: PlanLookupService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const user = userOf(req);
    if (user?.accountId && !user.isDemoAccount) return `acct:${user.accountId}`;
    return `ip:${req.ip}`;
  }

  /** True when the request's account is on a paid plan (or its plan is unknown). */
  async isPaid(req: Record<string, any>): Promise<boolean> {
    const user = userOf(req);
    if (!user?.accountId || user.isDemoAccount) return false;
    if (user.isPaidAccount) return true;
    if (!this.plans) return false;
    try {
      const plan = await this.plans.getPlan(user.accountId);
      return plan.status !== 'free';
    } catch (err: any) {
      this.log.warn(`Plan lookup failed for throttling (${err?.message ?? err}); using the paid limit.`);
      return true;
    }
  }

  protected async handleRequest(
    context: ExecutionContext,
    limit: number,
    ttl: number,
    throttler: ThrottlerOptions,
    getTracker: (req: Record<string, any>) => Promise<string> | string,
    generateKey: (context: ExecutionContext, trackerString: string, throttlerName: string) => string,
  ): Promise<boolean> {
    const { req } = this.getRequestResponse(context);
    const paid = await this.isPaid(req);
    (req as any).__throttlePaid = paid;
    const effective = paid ? Math.max(limit, paidMinuteLimit()) : limit;
    return super.handleRequest(context, effective, ttl, throttler, getTracker, generateKey);
  }

  protected async throwThrottlingException(context: ExecutionContext, detail: LimitDetail): Promise<void> {
    const { req } = this.getRequestResponse(context);
    const paid = !!(req as any).__throttlePaid;
    throw new HttpException(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'rate_limited', message: rateLimitedMessage(detail.limit, detail.ttl, paid) },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
