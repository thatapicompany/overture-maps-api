
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';
import { SwaggerModule, SwaggerCustomOptions } from '@nestjs/swagger';
import { buildOpenApiDocument } from './openapi/openapi.document';
import { RouteNotFoundFilter } from './openapi/route-not-found.filter';
const helmet = require('helmet');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Run onModuleDestroy on Cloud Run's SIGTERM so batched usage counters (and
  // the BigQuery usage sink) flush before the instance stops.
  app.enableShutdownHooks();
  app.use(helmet());
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  app.use(function (req, res, next) {
    res.header('x-powered-by', 'API by ThatAPICompany.com, Data by OvertureMaps.org');
    next();
  });

  const corsOptions = {
    "origin": "*",
    "methods": "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    "preflightContinue": false,
    "optionsSuccessStatus": 204,
    "credentials": false,
    "allowedHeaders": 'Content-Type, Authorization, Accept, Observe, x-api-key',
    "exposedHeaders": "Pagination-Count, Pagination-Page, Pagination-Limit, Query-Version, X-Quota-Plan, X-Quota-Limit, X-Quota-Hard-Limit, X-Quota-Used, X-Quota-Remaining, X-Quota-Reset, X-Quota-Warning, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset"
  }

  app.enableCors(corsOptions);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new RouteNotFoundFilter());


  // OpenAPI spec (src/openapi/openapi.document.ts) served as JSON at
  // /api-docs.json and as Swagger UI at /api-docs.
  const document = buildOpenApiDocument(app);
  const customOptions: SwaggerCustomOptions = {
    customfavIcon: 'https://overturemaps.org/wp-content/uploads/sites/16/2022/12/cropped-Favicon-150x150.png',
    customCss: '.swagger-ui .topbar { display: none }', // Hide the top bar of Swagger UI
    jsonDocumentUrl: '/api-docs.json',
    customSiteTitle: 'Overture Maps API Documentation',
  };
  SwaggerModule.setup('api-docs', app, document, customOptions);

  await app.listen(8080);
}
bootstrap();
