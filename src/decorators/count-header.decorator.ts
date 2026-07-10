import { UseInterceptors, applyDecorators } from '@nestjs/common';
import { PaginationInterceptor } from '../interceptors/pagination.interceptor';

/**
 * Historically set X-Total-Count on array responses; now applies the
 * PaginationInterceptor, which keeps that behaviour and adds the
 * Pagination-Count/Page/Limit headers + unwrapping of paginated envelopes.
 */
export function CountHeader() {
  return applyDecorators(UseInterceptors(PaginationInterceptor));
}
