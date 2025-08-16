import * as geojsonUtils from './geojson';

describe('geojson utils', () => {
  it('should have wrapAsGeoJSON defined', () => {
    expect(typeof geojsonUtils.wrapAsGeoJSON).toBe('function');
  });
});
