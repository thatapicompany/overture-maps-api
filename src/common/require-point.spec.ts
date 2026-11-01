import { BadRequestException } from '@nestjs/common';
import { requirePoint } from './require-point';

describe('requirePoint', () => {
  it('allows a point, including 0,0', () => {
    expect(() => requirePoint({ lat: 51.5, lng: -0.12 }, '/buildings')).not.toThrow();
    expect(() => requirePoint({ lat: 0, lng: 0 }, '/buildings')).not.toThrow();
  });

  it('rejects country-only and missing coordinates with a 400 naming the endpoint', () => {
    for (const q of [{}, { lat: 51.5 }, { lng: -0.12 }, { lat: NaN, lng: 1 }] as any[]) {
      expect(() => requirePoint(q, '/buildings')).toThrow(BadRequestException);
    }
    expect(() => requirePoint({ country: 'GB' } as any, '/addresses')).toThrow(/\/addresses needs lat and lng/);
  });
});
