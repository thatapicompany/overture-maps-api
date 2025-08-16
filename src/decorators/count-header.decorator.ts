import { UseInterceptors, applyDecorators } from '@nestjs/common';
import { CountHeaderInterceptor } from '../interceptors/count-header.interceptor';

export function CountHeader() {
  return applyDecorators(UseInterceptors(CountHeaderInterceptor));
}
