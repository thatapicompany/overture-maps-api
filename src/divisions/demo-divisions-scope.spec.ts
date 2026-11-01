import { BadRequestException } from '@nestjs/common';
import { checkDemoDivisionsScope } from './demo-divisions-scope';

const demo = { accountId: 'demo', isDemoAccount: true } as any;
const free = { accountId: 'acct-free-1' } as any;

describe('checkDemoDivisionsScope', () => {
  it('leaves real keys alone', () => {
    expect(() => checkDemoDivisionsScope({}, true, free)).not.toThrow();
  });

  it('allows the demo key a point, or a name search without geometry', () => {
    expect(() => checkDemoDivisionsScope({ lat: 51.5, lng: -0.12 }, true, demo)).not.toThrow();
    expect(() => checkDemoDivisionsScope({ lat: 0, lng: 0 }, true, demo)).not.toThrow();
    expect(() => checkDemoDivisionsScope({ name: 'Westminster' }, false, demo)).not.toThrow();
  });

  it('refuses country-wide, bbox-only and geometry name searches on the demo key', () => {
    expect(() => checkDemoDivisionsScope({}, true, demo)).toThrow(BadRequestException);
    expect(() => checkDemoDivisionsScope({}, false, demo)).toThrow(BadRequestException);
    expect(() => checkDemoDivisionsScope({ name: 'Westminster' }, true, demo)).toThrow(/demo key supports division searches by name/);
  });
});
