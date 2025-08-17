import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';

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

const demoCities = [{
  "city": "New York",
  "lat": 40.7128,
  "lng": -74.0060
},{
  "city":"London",
  "lat": 51.5074,
  "lng": -0.1278
},{
  "city":"Paris",
  "lat": 48.8566,
  "lng": 2.3522
},{
  "city":"Bondi Beach",
  "lat": -33.8910,
  "lng": 151.2769
}]


// Method decorator
export function ValidateLatLngUser(): MethodDecorator {
  return function (target, propertyKey, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const request = args[0]; // Assuming the first argument is the request object
      const lat = request?.lat;
      const lng = request?.lng;
      const user = args[1];

      if (lat && lng && user?.isDemoAccount) {
        // Allow within 10,000 meters of any demo city
        const withinRadius = demoCities.some(city =>
          haversineDistance(lat, lng, city.lat, city.lng) <= 10000
        );
        if (!withinRadius) {
          throw new BadRequestException(
            `Demo accounts can only access locations within 10,000 meters of demo cities. Demo cities: ${demoCities.map(city => JSON.stringify(city)).join(", ")}`
          );
        }
      }

      // Call the original method if validation passes
      return await originalMethod.apply(this, args);
    };
  };
}