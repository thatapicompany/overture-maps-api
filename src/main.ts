// src/main.ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

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


  // Configure Swagger
  const config = new DocumentBuilder()
    .setTitle('Overture Maps API Documentation')
    .setDescription('Auto-generated OpenAPI spec for the Overture Maps API')
    .setVersion('1.0')
    .addServer('http://localhost:8080/', 'Local environment')
    .addServer('https://overture-maps-api.thatapicompany.com','Cloud API Service')
    .setContact("Aden Forshaw", "https://thatapicompany.com/overture-maps-api", "aden@thatapicompany.com")
    .addApiKey(
      { type: 'apiKey', name: 'x-api-key', in: 'header' },
      'API_KEY', // Reference name for the security scheme
    )
    .addTag('places', 'Operations related to Places')
    .build();

  // Create the Swagger document
  const document = SwaggerModule.createDocument(app, config);
  // Serve the Swagger document at /api-docs
  SwaggerModule.setup('api-docs', app, document,{jsonDocumentUrl: '/api-docs-json', swaggerUrl: '/api-docs-ui'});


  await app.listen(8080);
}
bootstrap();
