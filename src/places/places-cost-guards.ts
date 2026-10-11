import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { User } from '../decorators/authed-user.decorator';
import { PlanStatus } from '../tiers/plan-lookup.service';

const logger = new Logger('PlacesCostGuards');
// Country-level /places queries (a `country` filter with no lat/lng) read a
// whole country's slice of the place table however narrow the other filters
// are: with the country mirror that is low single-digit GiB for a small
// country and more for the US; without it, the whole 45GB table. They are
// also the shape that lets one key paginate an entire country out of the API.
// That is a paid-plan feature, matching the radius error text that already
// says "Increase plan or request data at a country level". See
// etl/bigquery-cost-controls.md, section 7.
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

export interface PlanSource {
  getPlanStatus(accountId: string): Promise<PlanStatus>;
}

/**
 * Throws 403 when a Free account makes a country-level query. Demo accounts
 * are rejected earlier with their own message.
 *
 * Order: (1) not country-level, allow; (2) `user.isPaidAccount` (the
 * PAID_ACCOUNT_IDS override or TheAuthAPI key metadata), allow with no lookup;
 * (3) live plan from Firestore via `plans`: paid allows, free is a 403, and
 * `unknown` ALLOWS. Unknown covers a missing org doc, an unrecognised status,
 * a Firestore error and a timeout; none of those may lock out a paying
 * customer.
 */
export async function checkCountryLevelAllowed(query: CountryLevelQuery, user: User | undefined, plans: PlanSource): Promise<void> {
  if (!isCountryLevel(query)) return;
  if (user?.isPaidAccount) return;
  if (!user?.accountId) {
    throw new HttpException(COUNTRY_LEVEL_PAID_ONLY_MESSAGE, HttpStatus.FORBIDDEN);
  }
  const status = await plans.getPlanStatus(user.accountId);
  if (status === 'free') {
    throw new HttpException(COUNTRY_LEVEL_PAID_ONLY_MESSAGE, HttpStatus.FORBIDDEN);
  }
  if (status === 'unknown') {
    logger.warn(`Country-level query allowed for account ${user.accountId}: plan unknown (fail open).`);
  }
}
