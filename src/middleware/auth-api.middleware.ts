import {
  Injectable,
  NestMiddleware,
  Logger,
} from '@nestjs/common';

import { Request, Response } from 'express';
//import CacheService from '../cache/CacheService';
import TheAuthAPI from 'theauthapi';

const DEMO_API_KEY = 'demo-api-key';

@Injectable()
export class AuthAPIMiddleware implements NestMiddleware {
  private theAuthAPI: TheAuthAPI;

  constructor() { 
    if(process.env.AUTH_API_ACCESS_KEY)this.theAuthAPI = new TheAuthAPI(process.env.AUTH_API_ACCESS_KEY);
  }

  async use(req: Request, res: Response, next: () => void) {


    if (!req.get('X-Api-Key') && !req.get('api_key') && !req.get('api-key') || req.res.locals['user']?.id ) {
      next();
    } else {
      const key: string = req.get('X-Api-Key') || req.get('api_key') || req.get('api-key');


      if (key.toLowerCase() === DEMO_API_KEY) {
        req['user'] = req.res.locals['user'] = {
          metadata: {
            isDemoAccount:true
          },
          accountId: 'demo-account-id',
          userId: 'demo-user-id',
        };
        next();
        return;
      }

      try {
        if(!this.theAuthAPI) {
          Logger.error('APIKeyMiddleware Error: Auth API not initialized');
          next();
          return;
        }
        const apiKey = await this.theAuthAPI.apiKeys.authenticateKey(key); 
        if (apiKey) {
          const userObj = {
            metadata: apiKey.customMetaData,
            accountId: apiKey.customAccountId,
            userId: apiKey.customUserId,
          };

          //set to both req and locals for backwards compatibility
          req['user'] = req.res.locals['user'] = userObj;
        }
        next();
        return;
      } catch (error) {
        Logger.error('APIKeyMiddleware Error:', error, ` key: ${key}`);
      }
      next()
      return;
    }
  }
}
