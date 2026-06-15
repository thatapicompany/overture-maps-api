import { Module, NestMiddleware, MiddlewareConsumer, Logger } from '@nestjs/common';
import { BuildingsModule } from './buildings/buildings.module';
import { PlacesModule } from './places/places.module';
import { AddressesModule } from './addresses/addresses.module';
import { BaseModule } from './base/base.module';
import { TransportationModule } from './transportation/transportation.module';
import { DivisionsModule } from './divisions/divisions.module';
import { BigQueryService } from './bigquery/bigquery.service';
import { GcsService } from './gcs/gcs.service';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { Request, Response } from 'express';
import { AuthAPIMiddleware } from './middleware/auth-api.middleware';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppCacheModule } from './cache/cache.module';

@Module({
  imports: [
    AppCacheModule,
    BuildingsModule,
    PlacesModule,
    AddressesModule,
    BaseModule,
    TransportationModule,
    DivisionsModule,
    ConfigModule.forRoot(),
    // Per-client rate limiting. Each BigQuery-backed request can cost real money,
    // so cap request volume. Overridable via env without a redeploy.
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.THROTTLE_TTL_MS || '60000', 10),
        limit: parseInt(process.env.THROTTLE_LIMIT || '60', 10),
      },
    ]),
  ],
  controllers: [AppController],
  providers: [
    BigQueryService,
    GcsService,
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .forRoutes('*');

    consumer.apply(AuthAPIMiddleware)
      .forRoutes('*');

  }
}

class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: Function) {

    Logger.debug(`Request ${req.method} ${req.originalUrl}`)
    next();
  }
}