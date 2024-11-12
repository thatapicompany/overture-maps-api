import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';

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
      const user = args[1]

      if (lat && lng && user?.isDemoAccount) {
        //check if lat / lng is found as a demo city
        const foundCity = demoCities.find(city => city.lat === lat && city.lng === lng);
        if (!foundCity) {
          throw new BadRequestException(`Demo accounts can only access demo cities. These are ${demoCities.map(city => JSON.stringify(city)).join(", ")}`);
        }
      }

      // Call the original method if validation passes
      return await originalMethod.apply(this, args);
    };
  };
}