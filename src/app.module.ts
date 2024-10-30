// src/app.module.ts
import { Module,  NestMiddleware, MiddlewareConsumer, Logger, RequestMethod } from '@nestjs/common';
import { PlacesController } from './places/places.controller';
import { BigQueryService } from './bigquery/bigquery.service';
import { GcsService } from './gcs/gcs.service';
import { ConfigModule } from '@nestjs/config';
import {Request, Response} from 'express'
import { AuthAPIMiddleware } from './middleware/auth-api.middleware';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AppController,PlacesController],
  providers: [BigQueryService, GcsService,AppService],
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
  use(req:Request, res:Response, next: Function) {
  
    Logger.debug(`Request ${req.method} ${req.originalUrl}`)
    next();
  }
  }