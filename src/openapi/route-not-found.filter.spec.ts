import { Controller, Get, INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppController, ROBOTS_TXT } from '../app.controller';
import { AppService } from '../app.service';
import { RouteNotFoundFilter } from './route-not-found.filter';

@Controller('things')
class ThingsController {
  @Get(':id')
  getThing(): never {
    throw new NotFoundException('No thing found with id "x"');
  }
}

describe('RouteNotFoundFilter and crawler routes', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController, ThingsController],
      providers: [AppService],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalFilters(new RouteNotFoundFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers an unknown route with links to the docs and spec', async () => {
    const res = await request(app.getHttpServer()).get('/v1/places?lat=1').expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      message: expect.stringContaining('GET /v1/places'),
      openapi: expect.stringContaining('/api-docs.json'),
      llms_txt: expect.stringContaining('/llms.txt'),
    });
  });

  it('keeps the handler message for a 404 thrown by a route that exists', async () => {
    const res = await request(app.getHttpServer()).get('/things/x').expect(404);
    expect(res.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'No thing found with id "x"' });
  });

  it('serves robots.txt as plain text', async () => {
    const res = await request(app.getHttpServer()).get('/robots.txt').expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toBe(ROBOTS_TXT);
  });

  it('redirects llms.txt to the docs site', async () => {
    const res = await request(app.getHttpServer()).get('/llms.txt').expect(302);
    expect(res.headers.location).toBe('https://www.overturemapsapi.com/llms.txt');
  });

  it('links the spec, the Swagger UI and llms.txt from the root', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.body).toMatchObject({
      docs_openapi: 'https://api.overturemapsapi.com/api-docs.json',
      docs_ui: 'https://api.overturemapsapi.com/api-docs',
      llms_txt: 'https://www.overturemapsapi.com/llms.txt',
    });
  });
});
