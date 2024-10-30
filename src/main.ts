// src/main.ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);  
  app.useGlobalPipes(new ValidationPipe({forbidNonWhitelisted:true, whitelist:true}));
  app.use(bodyParser.json({limit: '50mb'}));
  app.use(bodyParser.urlencoded({limit: '50mb', extended: true}));

  app.use(function(req, res, next) {
    res.header('x-powered-by', 'API by ThatAPICompany.com, Data by OvertureMaps.org');
    next();
  });

  const corsOptions = {
    "origin": "*",
    "methods": "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    "preflightContinue": false,
    "optionsSuccessStatus": 204,
    "credentials":true,
    "allowedHeaders": 'Content-Type, Authorization, Accept, Observe,  api_key',
    "exposedHeaders":"Pagination-Count, Pagination-Page, Pagination-Limit, Query-Version"
  }
  app.enableCors(corsOptions);
  app.useGlobalPipes(new ValidationPipe({transform: true}));
  await app.listen(8080);
}
bootstrap();
