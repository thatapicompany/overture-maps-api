import { Controller, Get, Header, Redirect } from '@nestjs/common';
import { AppService } from './app.service';

import { ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DOCS_URL, PUBLIC_API_URL } from './openapi/openapi.document';

// Crawlers may read the root and the docs; data endpoints need a key anyway.
export const ROBOTS_TXT = ['User-agent: *', 'Allow: /$', 'Allow: /api-docs', 'Disallow: /', ''].join('\n');

@ApiTags('root')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    operationId: 'getServiceInfo',
    summary: 'Service information',
    description: 'Returns the service name and version with links to the docs, the OpenAPI spec and llms.txt. Needs no API key.',
  })
  @ApiResponse({ status: 200, description: 'Service information and documentation links.'})
  getHello(): {message:string, version:string, service:string, docs:string, docs_openapi:string, docs_ui:string, llms_txt:string} {
    return  {
      "service":this.appService.getAppName(),
      "version":this.appService.getVersion(), 
      message:"API by ThatAPICompany.com, Data by OvertureMaps.org",
      docs:`${DOCS_URL}/docs/intro`,
      docs_openapi:`${PUBLIC_API_URL}/api-docs.json`,
      docs_ui:`${PUBLIC_API_URL}/api-docs`,
      llms_txt:`${DOCS_URL}/llms.txt`,
    };
  }

  @Get('robots.txt')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  getRobots(): string {
    return ROBOTS_TXT;
  }

  @Get('llms.txt')
  @ApiExcludeEndpoint()
  @Redirect(`${DOCS_URL}/llms.txt`, 302)
  getLlmsTxt(): void {}

  // Paths AI tools and SDK generators try before reading any docs. Each one
  // lands on the real thing instead of a 404.
  @Get(['openapi.json', 'swagger.json', 'api-docs-json', 'api-json', '.well-known/openapi.json'])
  @ApiExcludeEndpoint()
  @Redirect('/api-docs.json', 302)
  getOpenApiAlias(): void {}

  @Get(['docs', 'documentation'])
  @ApiExcludeEndpoint()
  @Redirect(`${DOCS_URL}/docs/intro`, 302)
  getDocsAlias(): void {}

  @Get('llms-full.txt')
  @ApiExcludeEndpoint()
  @Redirect(`${DOCS_URL}/llms-full.txt`, 302)
  getLlmsFullTxt(): void {}
}
