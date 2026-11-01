import { BadRequestException } from '@nestjs/common';

// Endpoints whose queries are built around a point and radius. The shared
// location DTO accepts `country` in place of lat/lng (for /places and its
// country-level siblings), so without this check a country-only call reached
// BigQuery with no point and failed as a 500. Fail fast with a clear 400.
export function requirePoint(query: { lat?: number; lng?: number }, endpoint: string): void {
  // 0 is a real coordinate (equator, prime meridian): test for numbers, not truthiness
  if (Number.isFinite(query?.lat) && Number.isFinite(query?.lng)) return;
  throw new BadRequestException(
    `${endpoint} needs lat and lng (with an optional radius up to 25,000 metres). ` +
      'It does not support country-level queries.',
  );
}
