import { Injectable, Logger } from '@nestjs/common';
import { monthKey } from './usage-counter.store';

// Publishes a small message to Pub/Sub when an account is over its monthly
// allowance or at its limit, so anything downstream (emails, CRM, alerts) can
// react without living in this API. Off unless QUOTA_EVENTS_TOPIC is set, so
// self-hosters are unaffected.
//
// One message per account and kind at most every QUOTA_EVENTS_INTERVAL_MINUTES
// (default 60) per instance, while the account stays over. Consumers must be
// idempotent: several instances, restarts and Pub/Sub's at-least-once delivery
// all mean the same event can arrive more than once.
//
// Never throws and never holds a request for longer than
// QUOTA_EVENTS_TIMEOUT_MS (default 2000).

export type QuotaEventKind = 'allowance' | 'limit';

export interface QuotaEvent {
  accountId: string;
  plan: string;
  used: number;
  allowance: number;
  hardLimit: number;
  kind: QuotaEventKind;
  /** ISO timestamp of the request that triggered it. */
  at: string;
}

export type EventSink = (topic: string, event: QuotaEvent) => Promise<void>;

const envInt = (name: string, fallback: number): number => {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function quotaEventKind(used: number, allowance: number, hardLimit: number): QuotaEventKind | null {
  if (used >= hardLimit) return 'limit';
  if (used >= allowance) return 'allowance';
  return null;
}

@Injectable()
export class QuotaEventPublisher {
  private readonly logger = new Logger('QuotaEvents');
  private readonly lastSent = new Map<string, number>();
  private sink?: EventSink;

  /** Test seam. Production builds a Pub/Sub sink lazily. */
  configure(sink: EventSink): void {
    this.sink = sink;
    this.lastSent.clear();
  }

  async publish(ctx: Omit<QuotaEvent, 'kind' | 'at'> & { now: Date }): Promise<'off' | 'none' | 'throttled' | 'published' | 'failed'> {
    const topic = (process.env.QUOTA_EVENTS_TOPIC || '').trim();
    if (!topic) return 'off';
    const kind = quotaEventKind(ctx.used, ctx.allowance, ctx.hardLimit);
    if (!kind) return 'none';
    const key = `${ctx.accountId}:${kind}:${monthKey(ctx.now)}`;
    const nowMs = ctx.now.getTime();
    const intervalMs = envInt('QUOTA_EVENTS_INTERVAL_MINUTES', 60) * 60_000;
    const last = this.lastSent.get(key);
    if (last !== undefined && nowMs - last < intervalMs) return 'throttled';
    if (this.lastSent.size > 10_000) this.lastSent.clear();
    this.lastSent.set(key, nowMs);

    const event: QuotaEvent = {
      accountId: ctx.accountId, plan: ctx.plan, used: ctx.used,
      allowance: ctx.allowance, hardLimit: ctx.hardLimit, kind, at: ctx.now.toISOString(),
    };
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), envInt('QUOTA_EVENTS_TIMEOUT_MS', 2_000));
        timer.unref?.();
      });
      await Promise.race([this.getSink()(topic, event), timeout]);
      return 'published';
    } catch (err: any) {
      // Try again on a later request rather than waiting out the interval.
      this.lastSent.delete(key);
      this.logger.warn(`Quota event for account ${ctx.accountId} not published: ${err?.message ?? err}`);
      return 'failed';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private getSink(): EventSink {
    if (!this.sink) this.sink = pubsubSink();
    return this.sink;
  }
}

function pubsubSink(): EventSink {
  // Loaded on first use so the dependency costs nothing when events are off.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PubSub } = require('@google-cloud/pubsub');
  const client = new PubSub();
  const topics = new Map<string, any>();
  return async (topic, event) => {
    let t = topics.get(topic);
    if (!t) { t = client.topic(topic); topics.set(topic, t); }
    await t.publishMessage({ json: event, attributes: { kind: event.kind } });
  };
}
