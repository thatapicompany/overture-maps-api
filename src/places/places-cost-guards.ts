import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { User } from '../decorators/authed-user.decorator';
import { paidTierSourceConfigured } from '../middleware/account-tier';

const logger = new Logger('PlacesCostGuards');
let warnedUnconfigured = false;

// Country-level /places queries (a `country` filter with no lat/lng) read a
// whole country's slice of the place table however narrow the other filters
// are: with the country mirror that is low single-digit GiB for a small
// country and more for the US; without it, the whole 45GB table. They are
// also the shape that lets one key paginate an entire country out of the API.
// That is a paid-plan feature, matching the radius error text that already
// says "Increase plan or request data at a country level". Decided 10 Oct 2026
// after the 5 Oct spike (109 Free-plan country+name scans, A$41 in 3 hours);
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
 *
 * Fails OPEN when no paid-tier source is configured (PAID_ACCOUNT_IDS unset):
 * we cannot tell paid from Free, and blocking a paying customer is worse than
 * the bounded cost of letting a Free query through. Logged as an error once
 * per instance so a deploy that forgot the env var is visible.
 */
export function assertCountryLevelAllowed(query: CountryLevelQuery, user?: User): void {
  if (!isCountryLevel(query)) return;
  if (user?.isPaidAccount) return;
  if (!paidTierSourceConfigured()) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      logger.error('PAID_ACCOUNT_IDS is not set: country-level /places is NOT restricted to paid plans. Set it on the Cloud Run service.');
    }
    return;
  }
  throw new HttpException(COUNTRY_LEVEL_PAID_ONLY_MESSAGE, HttpStatus.FORBIDDEN);
}
