import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response, Request } from 'express';
import { wrapAsGeoJSON } from '../utils/geojson';
import { Format } from '../common/dto/requests/get-by-location.dto';

@Injectable()
export class PaginationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    return next.handle().pipe(
      map((data) => {
        if (!data) return data;

        const format = request.query.format;

        // Check if data is a paginated result object
        if (data && typeof data === 'object' && 'results' in data && 'totalCount' in data) {
          const { results, totalCount, page, limit } = data;

          response.set('X-Total-Count', String(totalCount));
          response.set('X-Page', String(page));
          response.set('X-Limit', String(limit));
          response.set('X-Offset', String(page * limit));

          if (format === Format.GEOJSON) {
            return wrapAsGeoJSON(results);
          }
          return results;
        }

        // Fallback for simple arrays
        if (Array.isArray(data)) {
          response.set('X-Total-Count', String(data.length));
          if (format === Format.GEOJSON) {
            return wrapAsGeoJSON(data);
          }
          return data;
        }

        return data;
      }),
    );
  }
}
