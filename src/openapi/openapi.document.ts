import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ACCOUNT_URL, PRICING_URL } from '../common/links';
import { Format } from '../common/dto/requests/get-by-location.dto';

// Self-hosted deployments can point these at their own URLs.
export const PUBLIC_API_URL = process.env.PUBLIC_API_URL || 'https://api.overturemapsapi.com';
export const DOCS_URL = process.env.DOCS_URL || 'https://www.overturemapsapi.com';

// Written for people and for AI tools that read the spec to decide how to call
// the API, so it front-loads auth, the cheap query shapes and how to recover
// from refusals.
const API_DESCRIPTION = `
REST API for [Overture Maps Foundation](https://overturemaps.org) open data: places (POIs), buildings, addresses, administrative divisions, base and transportation features. No BigQuery, Athena or GeoParquet needed.

## Authentication
Send your key in the \`x-api-key\` header. Get a free key at ${ACCOUNT_URL}. The public key \`DEMO-API-KEY\` works for small lat/lng searches near a few demo cities.

## Choosing a query
- Search by \`lat\` + \`lng\` + \`radius\` (metres, up to 25,000) wherever you can. It is the fastest and cheapest query on every plan.
- Country-level place searches (\`country\` with no \`lat\`/\`lng\`) need a paid plan and a narrowing filter such as \`categories\`, \`brand_name\` or \`name\`.
- Use \`GET /places/categories\` to find valid category values before filtering \`/places\` by \`categories\`.
- Results are paginated with \`limit\` and \`page\` (0-indexed). The \`Pagination-Count\` response header holds the total number of matches.
- \`format=geojson\` returns a GeoJSON FeatureCollection; the default \`json\` returns an array.

## Limits and errors
Each plan has a monthly request limit (see ${PRICING_URL}). Responses carry \`X-Quota-Limit\`, \`X-Quota-Used\`, \`X-Quota-Remaining\` and \`X-Quota-Reset\` headers. Errors return \`{ statusCode, message, error? }\`; the \`message\` explains how to fix the request. On \`429\`, wait for the \`Retry-After\` header before retrying.

## More
Docs and guides: ${DOCS_URL}/docs/intro · LLM-friendly index: ${DOCS_URL}/llms.txt · MCP server for Claude, ChatGPT and other AI tools: https://www.npmjs.com/package/@thatapicompany/overture-maps-mcp
`.trim();

const TAGS: [string, string][] = [
  ['Places', 'Points of interest: businesses, landmarks and amenities, with categories, brands, contact details and confidence scores.'],
  ['Buildings', 'Building footprints and attributes such as height and number of floors.'],
  ['Addresses', 'Address points.'],
  ['Divisions', 'Administrative areas: countries, regions, localities and neighbourhoods, with names and boundaries.'],
  ['Base', 'Base map features such as land use, land cover and water.'],
  ['Transportation', 'Road, rail and path segments.'],
  ['root', 'Service information and documentation links.'],
];

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Overture Maps API')
    .setDescription(API_DESCRIPTION)
    .setVersion('1.0')
    .addServer(PUBLIC_API_URL, 'Production')
    .setContact('ThatAPICompany', DOCS_URL, 'aden@thatapicompany.com')
    .setExternalDoc('Documentation and guides', `${DOCS_URL}/docs/intro`)
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-api-key',
        in: 'header',
        description: `Your API key from ${ACCOUNT_URL}. Use DEMO-API-KEY to try small lat/lng searches.`,
      },
      'API_KEY',
    )
    .addSecurityRequirements('API_KEY');
  for (const [name, description] of TAGS) builder.addTag(name, description);

  const document = SwaggerModule.createDocument(app, builder.build(), {
    // operationIds are set explicitly on each @ApiOperation; this is the fallback.
    operationIdFactory: (_controllerKey: string, methodKey: string) => methodKey,
  });

  // The root endpoint needs no key.
  const root = document.paths['/']?.get;
  if (root) root.security = [];
  normaliseParameters(document);
  return document;
}

/**
 * Many request DTOs omit an explicit type, which leaves generated clients and
 * AI tools guessing. Fill in types from each parameter's example/default, list
 * the format options, and mark lat/lng optional (most endpoints accept a
 * country or name instead; the descriptions say when a point is required).
 */
export function normaliseParameters(document: OpenAPIObject): void {
  for (const item of Object.values(document.paths)) {
    for (const op of Object.values(item as Record<string, any>)) {
      for (const param of (op?.parameters ?? []) as any[]) {
        if (param.in !== 'query') continue;
        const schema = (param.schema ??= {});
        if (param.name === 'format') {
          schema.type = 'string';
          schema.enum = Object.values(Format);
        }
        if (!schema.type && !schema.$ref && !schema.oneOf) {
          const sample = schema.example ?? schema.default;
          if (typeof sample === 'number') {
            schema.type = Number.isInteger(sample) && !['lat', 'lng', 'min_confidence'].includes(param.name) ? 'integer' : 'number';
          } else if (typeof sample === 'boolean' || sample === 'true' || sample === 'false') {
            schema.type = 'boolean';
          } else schema.type = 'string';
        }
        if (param.name === 'lat' || param.name === 'lng') param.required = false;
      }
    }
  }
}
