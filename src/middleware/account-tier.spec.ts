import { isPaidAccount, paidTierSourceConfigured } from './account-tier';

describe('isPaidAccount', () => {
  const prev = process.env.PAID_ACCOUNT_IDS;
  afterEach(() => {
    if (prev === undefined) delete process.env.PAID_ACCOUNT_IDS; else process.env.PAID_ACCOUNT_IDS = prev;
  });

  it('treats unknown accounts as Free', () => {
    delete process.env.PAID_ACCOUNT_IDS;
    expect(isPaidAccount('2255a93b-1a13-4cad-aee2-b71c7b9abd10')).toBe(false);
    expect(isPaidAccount(undefined)).toBe(false);
  });

  it('reads PAID_ACCOUNT_IDS per call, tolerating spaces and trailing commas', () => {
    process.env.PAID_ACCOUNT_IDS = ' 88756c26-b11b-476f-9aeb-4e817b1daf92 , other-id,';
    expect(isPaidAccount('88756c26-b11b-476f-9aeb-4e817b1daf92')).toBe(true);
    expect(isPaidAccount('other-id')).toBe(true);
    expect(isPaidAccount('')).toBe(false);
  });

  it('reports whether a paid-tier source is configured at all', () => {
    delete process.env.PAID_ACCOUNT_IDS;
    expect(paidTierSourceConfigured()).toBe(false);
    process.env.PAID_ACCOUNT_IDS = ' , ';
    expect(paidTierSourceConfigured()).toBe(false);
    process.env.PAID_ACCOUNT_IDS = 'a';
    expect(paidTierSourceConfigured()).toBe(true);
  });

  it('honours an explicit isPaidAccount flag in TheAuthAPI key metadata', () => {
    delete process.env.PAID_ACCOUNT_IDS;
    expect(isPaidAccount('x', { isPaidAccount: true })).toBe(true);
    expect(isPaidAccount('x', { isPaidAccount: 'yes' })).toBe(false);
    expect(isPaidAccount('x', { isDemoAccount: true })).toBe(false);
  });
});
