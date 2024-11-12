import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';

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
        throw new ForbiddenException('Demo accounts cannot access this feature');
      }

      // Call the original method if validation passes
      return await originalMethod.apply(this, args);
    };
  };
}