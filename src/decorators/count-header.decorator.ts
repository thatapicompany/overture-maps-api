import { UseInterceptors, applyDecorators } from '@nestjs/common';
import { PaginationInterceptor } from '../interceptors/pagination.interceptor';

export function CountHeader() {
  return applyDecorators(UseInterceptors(PaginationInterceptor));
}
