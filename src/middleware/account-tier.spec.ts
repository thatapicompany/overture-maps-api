import { isPaidAccount } from './account-tier';

describe('isPaidAccount', () => {
  const prev = process.env.PAID_ACCOUNT_IDS;
  afterEach(() => {
    if (prev === undefined) delete process.env.PAID_ACCOUNT_IDS; else process.env.PAID_ACCOUNT_IDS = prev;
  });

  it('treats unknown accounts as Free', () => {
    delete process.env.PAID_ACCOUNT_IDS;
    expect(isPaidAccount('free-acct')).toBe(false);
    expect(isPaidAccount(undefined)).toBe(false);
  });

  it('reads PAID_ACCOUNT_IDS per call, tolerating spaces and trailing commas', () => {
    process.env.PAID_ACCOUNT_IDS = ' paid-acct , other-id,';
    expect(isPaidAccount('paid-acct')).toBe(true);
    expect(isPaidAccount('other-id')).toBe(true);
    expect(isPaidAccount('')).toBe(false);
  });

  it('honours an explicit isPaidAccount flag in TheAuthAPI key metadata', () => {
    delete process.env.PAID_ACCOUNT_IDS;
    expect(isPaidAccount('x', { isPaidAccount: true })).toBe(true);
    expect(isPaidAccount('x', { isPaidAccount: 'yes' })).toBe(false);
    expect(isPaidAccount('x', { isDemoAccount: true })).toBe(false);
  });
});
