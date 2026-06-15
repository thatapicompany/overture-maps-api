import { buildCacheKey } from './cache-key.util';

describe('buildCacheKey', () => {
  it('is stable regardless of property order', () => {
    const a = buildCacheKey('get-places', { lat: 40.7, lng: -74, radius: 1000 });
    const b = buildCacheKey('get-places', { radius: 1000, lng: -74, lat: 40.7 });
    expect(a).toBe(b);
  });

  it('omits undefined, null and empty values', () => {
    const key = buildCacheKey('get-places', {
      lat: 40.7,
      lng: -74,
      country: undefined,
      brand_name: null,
      source: '',
    });
    expect(key).toBe('get-places:lat=40.7&lng=-74');
  });

  it('normalises array order so equivalent category sets collide', () => {
    const a = buildCacheKey('get-places', { categories: ['retail', 'food'] });
    const b = buildCacheKey('get-places', { categories: ['food', 'retail'] });
    expect(a).toBe(b);
    expect(a).toBe('get-places:categories=food,retail');
  });

  it('produces different keys for different data params', () => {
    const a = buildCacheKey('get-places', { lat: 40.7, lng: -74 });
    const b = buildCacheKey('get-places', { lat: 51.5, lng: -0.1 });
    expect(a).not.toBe(b);
  });
});
