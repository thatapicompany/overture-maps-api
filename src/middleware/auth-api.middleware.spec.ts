import { AuthAPIMiddleware } from './auth-api.middleware';

describe('AuthApiMiddleware', () => {
  it('should be defined', () => {
    expect(new AuthAPIMiddleware()).toBeDefined();
  });
});
