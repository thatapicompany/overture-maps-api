import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): {message:string, version:string, service:string} {
    return  {"service":this.appService.getAppName(),"version":this.appService.getVersion(), message:"API by ThatAPICompany.com, Data by OvertureMaps.org"};
  }
}
