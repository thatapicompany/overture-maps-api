import {
  Injectable,
  NestMiddleware,
  Logger,
} from '@nestjs/common';

import { Request, Response } from 'express';
//import CacheService from '../cache/CacheService';
import TheAuthAPI from 'theauthapi';

const DEMO_API_KEY = process.env.DEMO_API_KEY || 'DEMO-API-KEY';

@Injectable()
export class AuthAPIMiddleware implements NestMiddleware {

  private logger = new Logger('AuthAPIMiddleware');
  private theAuthAPI: TheAuthAPI;

  constructor() { 
    if(process.env.AUTH_API_ACCESS_KEY && process.env.AUTH_API_ACCESS_KEY!="create-one-from-theauthapi.com")this.theAuthAPI = new TheAuthAPI(process.env.AUTH_API_ACCESS_KEY);
  }

  getAPIKeyFromHeaderOrQuery(req: Request): string|undefined {

    // as this is an educational API we want to be a little flexible with the API key header names
    const apiKeys = ['X-Api-Key','api_key', 'api-key', 'apiKey', 'apikey'];

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
    
    //if no api key, or user is already set, skip
    if (!apiKeyString || req.res.locals['user']?.id ) {
      next();
    } else {

      try {
        
        // if theAuthAPI.com is integrated, check the key
        if(this.theAuthAPI) {
          
          const apiKey = await this.theAuthAPI.apiKeys.authenticateKey(apiKeyString); 
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
        }
      } catch (error) {
        Logger.error('APIKeyMiddleware Error:', error, ` key: ${apiKeyString}`);
      }

      //if demo key, set user to demo user
      if (apiKeyString === DEMO_API_KEY) {
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

      //if we got this far and they passed a key we should tell the user their key doesn't work and to check for a spelling mistake
      res.status(401).send('Unauthorized - check the spelling of your API Key');

      next()
      return;
    }
  }
}
