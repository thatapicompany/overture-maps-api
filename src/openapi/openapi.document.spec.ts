import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from '../app.module';
import { buildOpenApiDocument } from './openapi.document';
import { routeNotFoundBody } from './route-not-found.filter';

// Guards the qualities SDK generators and AI tools rely on: unique, readable
// operationIds, a description on every operation, the API key applied
// globally, and documented error responses.
describe('OpenAPI document', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;
  let ops: { path: string; method: string; op: any }[];

  beforeAll(async () => {
    // preview mode builds the route graph without instantiating providers, so
    // no BigQuery, Firestore or network access is needed.
    app = await NestFactory.create(AppModule, { preview: true, logger: false, abortOnError: false });
    doc = buildOpenApiDocument(app);
    ops = Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.entries(item as any)
        .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
        .map(([method, op]) => ({ path, method, op })),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lists every public endpoint', () => {
    const paths = Object.keys(doc.paths).sort();
    expect(paths).toEqual(
      expect.arrayContaining([
        '/', '/places', '/places/brands', '/places/buildings', '/places/categories', '/places/countries',
        '/buildings', '/addresses', '/base', '/transportation', '/divisions', '/divisions/{id}',
      ]),
    );
    expect(paths).not.toContain('/robots.txt');
    expect(paths).not.toContain('/llms.txt');
  });

  it('gives every operation a unique camelCase operationId', () => {
    const ids = ops.map((o) => o.op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][A-Za-z]+$/);
  });

  it('gives every operation a summary and a substantive description', () => {
    for (const { path, op } of ops) {
      expect([path, typeof op.summary]).toEqual([path, 'string']);
      expect([path, (op.description ?? '').length > 40]).toEqual([path, true]);
    }
  });

  it('requires the API key globally and exempts only the root endpoint', () => {
    expect(doc.security).toEqual([{ API_KEY: [] }]);
    expect(doc.components?.securitySchemes?.API_KEY).toMatchObject({ type: 'apiKey', in: 'header', name: 'x-api-key' });
    expect(doc.paths['/'].get?.security).toEqual([]);
  });

  it('types every query parameter and lists the format options', () => {
    for (const { path, op } of ops) {
      for (const p of op.parameters ?? []) {
        if (p.in !== 'query') continue;
        expect([path, p.name, !!(p.schema?.type || p.schema?.$ref || p.schema?.oneOf)]).toEqual([path, p.name, true]);
      }
    }
    const format = doc.paths['/places'].get?.parameters?.find((p: any) => p.name === 'format') as any;
    expect(format.schema.enum).toEqual(['json', 'csv', 'geojson']);
    const lat = doc.paths['/places'].get?.parameters?.find((p: any) => p.name === 'lat') as any;
    expect(lat.required).toBe(false);
  });

  it('lists only the production server', () => {
    expect(doc.servers?.map((s) => s.url)).toEqual(['https://api.overturemapsapi.com']);
  });

  it('documents 400, 401, 403 and 429 (with Retry-After) on every data endpoint', () => {
    for (const { path, op } of ops.filter((o) => o.path !== '/')) {
      for (const code of ['400', '401', '403', '429']) expect([path, code, !!op.responses[code]]).toEqual([path, code, true]);
      expect(op.responses['429'].headers?.['Retry-After']).toBeDefined();
    }
  });

  it('documents pagination headers on list endpoints', () => {
    expect(doc.paths['/places'].get?.responses['200']).toMatchObject({
      headers: { 'Pagination-Count': expect.any(Object) },
    });
  });

  it('describes auth, query choice and errors in the API description', () => {
    const d = doc.info.description ?? '';
    expect(d).toContain('x-api-key');
    expect(d).toContain('DEMO-API-KEY');
    expect(d).toContain('Retry-After');
    expect(d).toContain('/llms.txt');
  });

  it('has a description for every tag in use', () => {
    const declared = new Map((doc.tags ?? []).map((t) => [t.name, t.description]));
    for (const { path, op } of ops) for (const tag of op.tags ?? []) expect([path, tag, !!declared.get(tag)]).toEqual([path, tag, true]);
  });
});

describe('routeNotFoundBody', () => {
  it('points a wrong guess at the docs and the spec', () => {
    expect(routeNotFoundBody('GET', '/v1/places')).toMatchObject({
      statusCode: 404,
      message: expect.stringContaining('GET /v1/places'),
      openapi: 'https://api.overturemapsapi.com/api-docs.json',
      llms_txt: 'https://www.overturemapsapi.com/llms.txt',
    });
  });
});
