import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response, Request } from 'express';
import { wrapAsGeoJSON } from '../utils/geojson';
import { Format } from '../common/dto/requests/get-by-location.dto';

/**
 * Result envelope services/controllers return for paginated endpoints. The
 * interceptor unwraps it, so the response body clients receive stays exactly
 * what it always was (an array, or a GeoJSON FeatureCollection) — pagination
 * metadata travels in headers only:
 *
 *   Pagination-Count — total results matching the query (across all pages)
 *   Pagination-Page  — the page served (0-indexed)
 *   Pagination-Limit — the page size
 *   X-Total-Count    — number of results in THIS response (legacy, unchanged)
 *
 * Pagination-* are already in the CORS exposedHeaders list in main.ts.
 */
export interface PaginatedResult<T = any> {
  results: T[];
  totalCount: number;
  page?: number;
  limit?: number;
}

export const isPaginatedResult = (data: any): data is PaginatedResult =>
  !!data && typeof data === 'object' && Array.isArray(data.results) && 'totalCount' in data;

@Injectable()
export class PaginationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    return next.handle().pipe(
      map((data) => {
        if (!data) return data;

        if (isPaginatedResult(data)) {
          const { results, totalCount, page = 0, limit } = data;
          response.set('Pagination-Count', String(totalCount));
          response.set('Pagination-Page', String(page));
          if (limit !== undefined) response.set('Pagination-Limit', String(limit));
          response.set('X-Total-Count', String(results.length));

          return request.query.format === Format.GEOJSON ? wrapAsGeoJSON(results) : results;
        }

        // Plain arrays (unpaginated endpoints like /places/brands): keep the
        // legacy header behaviour and mirror it into Pagination-Count.
        if (Array.isArray(data)) {
          response.set('X-Total-Count', String(data.length));
          response.set('Pagination-Count', String(data.length));
        }
        return data;
      }),
    );
  }
}
