/**
 * Writes the OpenAPI spec to a file without starting the server or touching
 * BigQuery (Nest preview mode). Used to refresh api-docs.json in this repo and
 * the copy the docs site renders.
 *
 *   npm run openapi:export                      # writes ./api-docs.json
 *   npm run openapi:export -- ../overture-maps-dev-portal/openapi/overture-maps-api-openapi.json
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/openapi/openapi.document';

async function main() {
  const out = resolve(process.argv[2] ?? 'api-docs.json');
  const app = await NestFactory.create(AppModule, { preview: true, logger: false, abortOnError: false });
  const document = buildOpenApiDocument(app);
  writeFileSync(out, JSON.stringify(document, null, 2) + '\n');
  await app.close();
  console.log(`Wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
