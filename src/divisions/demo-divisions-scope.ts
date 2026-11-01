import { BadRequestException } from '@nestjs/common';
import { ACCOUNT_URL } from '../common/links';
import { User } from '../decorators/authed-user.decorator';

// The demo key is for trying the API out, so on /divisions it gets the cheap
// shapes only: a point near a demo city (DemoLocationGuard checks the city), or
// a name search without geometry, which the in-memory index usually answers
// with no BigQuery scan at all. Country-wide, bbox-only and geometry-heavy
// searches without a point read several GiB each, so they need a real key.
export const DEMO_DIVISIONS_MESSAGE =
  'The demo key supports division searches by name (without geometry) or by lat/lng near a demo city. ' +
  `Get a free API key for country-wide, bounding-box and geometry searches: ${ACCOUNT_URL}`;

export interface DivisionsScopeQuery {
  lat?: number;
  lng?: number;
  name?: string;
}

export function checkDemoDivisionsScope(query: DivisionsScopeQuery, includeGeometry: boolean, user: User | undefined): void {
  if (!user?.isDemoAccount) return;
  // 0 is a real coordinate: test for numbers, not truthiness
  if (Number.isFinite(query.lat) && Number.isFinite(query.lng)) return;
  if (query.name && query.name.trim().length >= 2 && !includeGeometry) return;
  throw new BadRequestException(DEMO_DIVISIONS_MESSAGE);
}
