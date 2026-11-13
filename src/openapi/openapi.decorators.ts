import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

/** Shape of every error body the API returns. */
export class ErrorResponseDto {
  @ApiProperty({ example: 400, description: 'HTTP status code, repeated in the body.' })
  statusCode: number;

  @ApiProperty({
    description:
      'Human-readable explanation, written to be shown to the end user or relayed by an AI assistant. ' +
      'Often says how to fix the request (a narrower filter, a lat/lng search, or a plan that allows it). ' +
      'Validation errors return an array of messages.',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Radius must be 25000 meters or less.',
  })
  message: string | string[];

  @ApiPropertyOptional({
    description: 'Machine-readable reason, e.g. `monthly_quota_exceeded` or `rate_limited` on a 429.',
    example: 'monthly_quota_exceeded',
  })
  error?: string;
}

/** Response headers on every paginated list endpoint (see PaginationInterceptor). */
export const PAGINATION_HEADERS = {
  'Pagination-Count': {
    description: 'Total number of results matching the query, across all pages.',
    schema: { type: 'integer' },
  },
  'Pagination-Page': { description: 'The page served (0-indexed).', schema: { type: 'integer' } },
  'Pagination-Limit': { description: 'The page size used.', schema: { type: 'integer' } },
  'X-Total-Count': { description: 'Number of results in this response.', schema: { type: 'integer' } },
};

/**
 * The refusals any authenticated endpoint can return. Documented once here so
 * clients, SDK generators and AI tools know how to recover from each.
 */
export function ApiStandardErrors() {
  return applyDecorators(
    ApiBadRequestResponse({
      description:
        'The query is invalid or too broad: a parameter failed validation, a required location is missing, ' +
        'or the demo key was used outside its limits. The message says what to change.',
      type: ErrorResponseDto,
    }),
    ApiUnauthorizedResponse({
      description: 'No API key, or the key is not valid. Send it in the `x-api-key` header.',
      type: ErrorResponseDto,
    }),
    ApiForbiddenResponse({
      description:
        'The key is valid but its plan does not allow this query (for example a country-level /places query on the Free plan). ' +
        'Search by `lat`/`lng`/`radius` instead, or upgrade.',
      type: ErrorResponseDto,
    }),
    ApiTooManyRequestsResponse({
      description:
        'Rate limited. `error` is `rate_limited` for the per-minute limit or `monthly_quota_exceeded` for the plan\'s monthly limit. ' +
        'Wait for `Retry-After` seconds before retrying; do not retry immediately.',
      type: ErrorResponseDto,
      headers: {
        'Retry-After': { description: 'Seconds to wait before retrying.', schema: { type: 'integer' } },
      },
    }),
  );
}
