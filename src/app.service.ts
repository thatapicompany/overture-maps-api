import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {

  getVersion(): string {
    return process.env.npm_package_version;
  }
  getAppName(): string {
    return process.env.npm_package_name;
  }
}
