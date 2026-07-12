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

describe('AuthAPIMiddleware upstream error handling', () => {
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

  // Mirrors TheAuthAPI SDK's ApiResponseError
  const apiResponseError = (statusCode: number, message: string) => {
    const error: any = new Error(`(${statusCode}): ${message}`);
    error.name = 'ApiResponseError';
    error.statusCode = statusCode;
    error.message = message;
    return error;
  };

  const middlewareThrowing = (error: any) => {
    const middleware = new AuthAPIMiddleware();
    (middleware as any).theAuthAPI = {
      apiKeys: { authenticateKey: jest.fn().mockRejectedValue(error) },
    };
    return middleware;
  };

  it('returns 429 when the key is rate limited, NOT a misleading 401', async () => {
    const middleware = middlewareThrowing(
      apiResponseError(429, 'Rate limit exceeded'),
    );
    const { req, res } = makeReqRes('live_real_key');
    const next = jest.fn();

    await middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.send).toHaveBeenCalledWith('Rate limit exceeded');
  });

  it('strips the SDK status prefix from the message it passes on', async () => {
    // The real SDK message looks like "(429): Too many requests"
    const error: any = new Error('(429): Too many requests');
    error.statusCode = 429;
    error.message = '(429): Too many requests';
    const middleware = middlewareThrowing(error);
    const { req, res } = makeReqRes('live_real_key');

    await middleware.use(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.send).toHaveBeenCalledWith('Too many requests');
  });

  it('returns 429 when the monthly quota is exceeded', async () => {
    const middleware = middlewareThrowing(
      apiResponseError(429, 'Monthly request quota exceeded'),
    );
    const { req, res } = makeReqRes('live_real_key');

    await middleware.use(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.send).toHaveBeenCalledWith('Monthly request quota exceeded');
  });

  it('still returns 403 for a disallowed origin domain', async () => {
    const middleware = middlewareThrowing(
      apiResponseError(403, 'Origin domain is not allowed for this API key'),
    );
    const { req, res } = makeReqRes('live_real_key');

    await middleware.use(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 503 when TheAuthAPI is erroring, rather than blaming the key', async () => {
    const middleware = middlewareThrowing(
      apiResponseError(500, 'Internal Server Error'),
    );
    const { req, res } = makeReqRes('live_real_key');

    await middleware.use(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 503 when TheAuthAPI is unreachable (no status on the error)', async () => {
    const middleware = middlewareThrowing(new Error('connect ECONNREFUSED'));
    const { req, res } = makeReqRes('live_real_key');

    await middleware.use(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('still returns 401 for a genuinely unknown key (404 upstream)', async () => {
    const middleware = middlewareThrowing(apiResponseError(404, 'Not Found'));
    const { req, res } = makeReqRes('live_wrong_key');

    await middleware.use(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
  });
});
