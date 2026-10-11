import { HttpException, HttpStatus } from '@nestjs/common';
import { User } from '../decorators/authed-user.decorator';

// Country-level /places queries (a `country` filter with no lat/lng) read a
// whole country's slice of the place table however narrow the other filters
// are: with the country mirror that is low single-digit GiB for a small
// country and more for the US; without it, the whole 45GB table. They are
// also the shape that lets one key paginate an entire country out of the API.
// That is a paid-plan feature, matching the radius error text that already
// says "Increase plan or request data at a country level". Decided 10 Oct 2026
// after the 5 Oct spike (109 Free-plan country+name scans in 3 hours);
// see docs/cost-budget-rate-limiting.md.
export const COUNTRY_LEVEL_PAID_ONLY_MESSAGE =
  'Country-level queries (a country filter without lat/lng) are available on paid plans. ' +
  'Free plans query by lat, lng and radius (up to 25 km). See https://overturemapsapi.com/pricing';

export interface CountryLevelQuery {
  lat?: number;
  lng?: number;
  country?: string;
}

export function hasLatLng(query: CountryLevelQuery): boolean {
  return Number.isFinite(query.lat) && Number.isFinite(query.lng);
}

/** True when the request is a country-level query: `country` set, no lat/lng. */
export function isCountryLevel(query: CountryLevelQuery): boolean {
  return !!query.country && !hasLatLng(query);
}

/**
 * Throws 403 when a non-paid account makes a country-level query. Demo
 * accounts are rejected earlier with their own message; this covers Free.
 * Pure and framework-light so it can be unit tested without a Nest module.
 */
export function assertCountryLevelAllowed(query: CountryLevelQuery, user?: User): void {
  if (!isCountryLevel(query)) return;
  if (user?.isPaidAccount) return;
  throw new HttpException(COUNTRY_LEVEL_PAID_ONLY_MESSAGE, HttpStatus.FORBIDDEN);
}
