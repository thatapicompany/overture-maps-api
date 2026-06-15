import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { User } from '../decorators/authed-user.decorator';

// Helper to calculate distance between two lat/lng points in meters
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (x: number) => x * Math.PI / 180;
  const R = 6371000; // meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const DEMO_CITIES = [
  { city: 'New York', lat: 40.7128, lng: -74.0060 },
  { city: 'London', lat: 51.5074, lng: -0.1278 },
  { city: 'Paris', lat: 48.8566, lng: 2.3522 },
  { city: 'Bondi Beach', lat: -33.8910, lng: 151.2769 },
];

const DEMO_RADIUS_METERS = 10000;

/**
 * Restricts demo accounts to locations near the demo cities. Applied at the
 * controller level so every geographic endpoint (places, buildings, addresses,
 * transportation, divisions, base) enforces the same cost guard, rather than
 * relying on a per-handler decorator.
 */
@Injectable()
export class DemoLocationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request: Request = context.switchToHttp().getRequest();
    const user = (request['user'] || request.res?.locals?.user) as User | undefined;

    if (!user?.isDemoAccount) {
      return true;
    }

    // Query params are still raw strings at the guard stage (validation/transform
    // runs in the pipe afterwards), so parse defensively.
    const lat = parseFloat(request.query.lat as string);
    const lng = parseFloat(request.query.lng as string);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return true;
    }

    const withinRadius = DEMO_CITIES.some(
      (city) => haversineDistance(lat, lng, city.lat, city.lng) <= DEMO_RADIUS_METERS,
    );

    if (!withinRadius) {
      throw new BadRequestException(
        `Demo accounts can only access locations within ${DEMO_RADIUS_METERS} meters of demo cities. Demo cities: ${DEMO_CITIES.map((city) => JSON.stringify(city)).join(', ')}. Signup for a Free account at https://overturemaps.com/`,
      );
    }

    return true;
  }
}
