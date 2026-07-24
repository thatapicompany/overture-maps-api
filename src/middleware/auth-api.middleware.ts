import {
  Injectable,
  NestMiddleware,
  Logger,
} from '@nestjs/common';

import { Request, Response } from 'express';
import { User } from '../decorators/authed-user.decorator';
//import CacheService from '../cache/CacheService';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const TheAuthAPI = require('theauthapi');

// Only enabled when explicitly configured. No literal fallback so an unset env
// var can never leave a publicly-known demo credential valid in production.
// Read per-request so tests (and runtime config changes) take effect without
// a module reload.
const getDemoApiKey = (): string | undefined => process.env.DEMO_API_KEY;

// Avoid writing raw API keys to logs.
function maskKey(key?: string): string {
  if (!key) return '(none)';
  if (key.length <= 4) return '****';
  return `${key.slice(0, 2)}****${key.slice(-2)}`;
}


@Injectable()
export class AuthAPIMiddleware implements NestMiddleware {

  private logger = new Logger('AuthAPIMiddleware');
  private theAuthAPI: any;

  constructor() {
    if (process.env.AUTH_API_ACCESS_KEY && process.env.AUTH_API_ACCESS_KEY != "create-one-from-theauthapi.com") this.theAuthAPI = new TheAuthAPI(process.env.AUTH_API_ACCESS_KEY);
  }

  getAPIKeyFromHeaderOrQuery(req: Request): string | undefined {

    // as this is an educational API we want to be a little flexible with the API key header names
    const apiKeys = ['X-Api-Key', 'api_key', 'api-key', 'apiKey', 'apikey'];

    //check if any in the headers
    const header: string | undefined = apiKeys
      .map((key) => req.get(key))
      .find((value) => value !== undefined);

    if (header) {
      return header;
    }


    const queryParam: string | undefined = apiKeys
      .map((key) => req.query[key] as string | undefined)
      .find((value) => value !== undefined);

    return queryParam;

  }

  async use(req: Request, res: Response, next: () => void) {

    const apiKeyString = this.getAPIKeyFromHeaderOrQuery(req);

    //if no api key, or user is already set, skip — the route guard decides whether anonymous is allowed
    if (!apiKeyString || req.res.locals['user']?.userId) {
      next();
      return;
    }

    // Demo key first: it's a constant-string compare, saves a TheAuthAPI
    // round-trip, and must run before the explicit rejection below —
    // TheAuthAPI doesn't know the demo key, so checking it afterwards means
    // it can never match (this exact ordering bug shipped in Jun 2026).
    // Only enabled when DEMO_API_KEY is explicitly configured.
    const demoApiKey = getDemoApiKey();
    if (demoApiKey && apiKeyString === demoApiKey) {
      const demoUser: User = {
        isDemoAccount: true,
        accountId: 'demo-account-id',
        userId: 'demo-user-id'
      };
      req['user'] = req.res.locals['user'] = demoUser;
      next();
      return;
    }

    try {

      // if theAuthAPI.com is integrated, check the key
      if (this.theAuthAPI) {
        const origin = (req.headers['origin'] as string) || (req.headers['referer'] as string);
        const apiKey = await this.theAuthAPI.apiKeys.authenticateKey(apiKeyString, origin);
        if (apiKey) {
          const metaData = apiKey.customMetaData as any;
          const userObj: User = {
            isDemoAccount: metaData.isDemoAccount || false,
            accountId: apiKey.customAccountId,
            userId: apiKey.customUserId,
          };

          //set to both req and locals for backwards compatibility
          req['user'] = req.res.locals['user'] = userObj;
          next();
          return;
        }

        // a key was supplied but did not authenticate — reject explicitly
        // instead of silently continuing as anonymous.
        res.status(401).send('Unauthorized - check the spelling of your API Key');
        return;
      }
    } catch (error: any) {
      Logger.error('APIKeyMiddleware Error:', error, ` key: ${maskKey(apiKeyString)}`);

      // TheAuthAPI's SDK throws ApiResponseError carrying the upstream HTTP
      // status. Surface the ones that mean something specific to the caller
      // rather than collapsing them all into "check your spelling".
      const status = getUpstreamStatus(error);

      if (status === 403) {
        res.status(403).send(error.message || 'Origin domain is not allowed for this API key');
        return;
      }

      // The key is valid but over its rate limit or monthly quota. Telling
      // the caller their key is misspelled here is actively misleading.
      if (status === 429) {
        res.status(429).send(cleanUpstreamMessage(error.message, 'Too many requests - rate limit exceeded for this API key'));
        return;
      }

      // TheAuthAPI is unreachable or erroring: this is our problem, not a bad
      // key. A 401 would send customers hunting for a typo during an outage.
      if (status === undefined || status >= 500) {
        res
          .status(503)
          .send('Unable to verify your API key right now - please retry shortly');
        return;
      }
    }

    //if we got this far and they passed a key we should tell the user their key doesn't work and to check for a spelling mistake
    res.status(401).send('Unauthorized - check the spelling of your API Key');
    return;
  }
}

// The status may arrive as ApiResponseError.statusCode, or on an axios-shaped
// error, depending on where it was thrown.
function getUpstreamStatus(error: any): number | undefined {
  return error?.statusCode ?? error?.status ?? error?.response?.status;
}

// TheAuthAPI's SDK prefixes its messages with the status, e.g.
// "(429): Too many requests". Strip that so callers get a clean sentence.
function cleanUpstreamMessage(message: string | undefined, fallback: string): string {
  const stripped = message?.replace(/^\(\d{3}\):\s*/, '').trim();
  return stripped || fallback;
}
