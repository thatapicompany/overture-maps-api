
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';
import { DocumentBuilder, SwaggerModule, SwaggerCustomOptions, SwaggerDocumentOptions } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);  
  app.useGlobalPipes(new ValidationPipe({forbidNonWhitelisted:false, whitelist:true}));
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
    .setDescription('OpenAPI docs for the Overture Maps API')
    .setVersion('1.0')
    .addServer('http://localhost:8080/', 'Local environment')
    .addServer('https://api.overturemapsapi.com','Cloud API Service')
    .setContact("Aden Forshaw", "https://thatapicompany.com/overture-maps-api", "aden@thatapicompany.com")
    .addApiKey(
      { type: 'apiKey', name: 'x-api-key', in: 'header' },
      'API_KEY', // Reference name for the security scheme
    )
    .addTag('places', 'Operations related to Places')
    .build();

  // Create the Swagger document
  const document = SwaggerModule.createDocument(app, config);

  const customOptions: SwaggerCustomOptions = {
    customfavIcon: 'https://overturemaps.org/wp-content/uploads/sites/16/2022/12/cropped-Favicon-150x150.png',
    customCss: '.swagger-ui .topbar { display: none }', // Hide the top bar of Swagger UI
    jsonDocumentUrl: '/api-docs.json', swaggerUrl: '/api-docs-ui',
    customSiteTitle: 'Overture Maps API Documentation',
  };


  const docOptions: SwaggerDocumentOptions = {
    operationIdFactory: (controllerKey: string, methodKey: string) => methodKey,
  };

  // Serve the Swagger document at /api-docs
  SwaggerModule.setup('api-docs', app, document,customOptions);


  await app.listen(8080);
}
bootstrap();
