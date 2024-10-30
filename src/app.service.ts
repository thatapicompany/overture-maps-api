import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'API by ThatAPICompany.com, Data by OvertureMaps.org';
  }
}
