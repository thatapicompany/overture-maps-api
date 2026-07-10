import { AuthAPIMiddleware } from './auth-api.middleware';

describe('AuthApiMiddleware', () => {
  it('should be defined', () => {
    expect(new AuthAPIMiddleware()).toBeDefined();
  });
});

// Regression tests for the demo API key path. In Jun 2026 a hardening change
// made TheAuthAPI rejection return 401 *before* the demo-key check ran, which
// silently disabled the public demo key in production. The demo key must be
// honoured before any TheAuthAPI call.
describe('AuthAPIMiddleware demo key handling', () => {
  const DEMO_KEY = 'TEST-DEMO-KEY';
  let originalEnv: string | undefined;

  const makeReqRes = (apiKey?: string) => {
    const locals: any = {};
    const res: any = {
      locals,
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    const req: any = {
      get: (name: string) => (name === 'X-Api-Key' ? apiKey : undefined),
      query: {},
      headers: {},
      res,
    };
    req.res.locals = locals;
    return { req, res };
  };

  beforeEach(() => {
    originalEnv = process.env.DEMO_API_KEY;
    process.env.DEMO_API_KEY = DEMO_KEY;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.DEMO_API_KEY;
    else process.env.DEMO_API_KEY = originalEnv;
  });

  it('authenticates the demo key WITHOUT calling TheAuthAPI, even when TheAuthAPI is configured', async () => {
    const middleware = new AuthAPIMiddleware();
    const authenticateKey = jest.fn().mockResolvedValue(null); // TheAuthAPI does not know the demo key
    (middleware as any).theAuthAPI = { apiKeys: { authenticateKey } };

    const { req, res } = makeReqRes(DEMO_KEY);
    const next = jest.fn();
    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(expect.objectContaining({ isDemoAccount: true }));
    expect(authenticateKey).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects unknown keys with 401 when TheAuthAPI does not authenticate them', async () => {
    const middleware = new AuthAPIMiddleware();
    (middleware as any).theAuthAPI = { apiKeys: { authenticateKey: jest.fn().mockResolvedValue(null) } };

    const { req, res } = makeReqRes('not-a-real-key');
    const next = jest.fn();
    await middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('does NOT accept the well-known literal when DEMO_API_KEY is unset (no fallback)', async () => {
    delete process.env.DEMO_API_KEY;
    const middleware = new AuthAPIMiddleware();
    (middleware as any).theAuthAPI = { apiKeys: { authenticateKey: jest.fn().mockResolvedValue(null) } };

    const { req, res } = makeReqRes('DEMO-API-KEY');
    const next = jest.fn();
    await middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('still authenticates real keys via TheAuthAPI', async () => {
    const middleware = new AuthAPIMiddleware();
    const authenticateKey = jest.fn().mockResolvedValue({
      customMetaData: { isDemoAccount: false },
      customAccountId: 'acc-1',
      customUserId: 'user-1',
    });
    (middleware as any).theAuthAPI = { apiKeys: { authenticateKey } };

    const { req, res } = makeReqRes('live_real_key');
    const next = jest.fn();
    await middleware.use(req, res, next);

    expect(authenticateKey).toHaveBeenCalledWith('live_real_key', undefined);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(expect.objectContaining({ accountId: 'acc-1', isDemoAccount: false }));
  });
});
