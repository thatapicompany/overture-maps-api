import { Module, NestMiddleware, MiddlewareConsumer, Logger } from '@nestjs/common';
import { BuildingsModule } from './buildings/buildings.module';
import { PlacesModule } from './places/places.module';
import { BigQueryService } from './bigquery/bigquery.service';
import { GcsService } from './gcs/gcs.service';
import { ConfigModule } from '@nestjs/config';
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
    ConfigModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [BigQueryService, GcsService, AppService],
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