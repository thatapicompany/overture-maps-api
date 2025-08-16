import { IsAuthenticatedGuard } from './is-authenticated.guard';

describe('IsAuthenticatedGuard', () => {
  it('should be defined', () => {
    expect(new IsAuthenticatedGuard()).toBeDefined();
  });
});
