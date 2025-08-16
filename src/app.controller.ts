import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('root')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Welcome to the Overture Maps API' })
  @ApiResponse({ status: 200, description: 'Return a welcome message and links to the API documentation.'})
  getHello(): {message:string, version:string, service:string, docs_openapi:string, docs_ui:string} {
    return  {
      "service":this.appService.getAppName(),
      "version":this.appService.getVersion(), 
      message:"API by ThatAPICompany.com, Data by OvertureMaps.org",
      docs_openapi:"https://overture-maps-api.thatapicompany.com/api-docs",
      docs_ui:"https://overture-maps-api.thatapicompany.com/api-docs-ui"
    };
  }
}
