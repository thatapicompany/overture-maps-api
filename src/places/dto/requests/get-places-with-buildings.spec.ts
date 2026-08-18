import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetPlacesWithBuildingsDto } from './get-places-with-buildings';

describe('GetPlacesWithBuildingsDto', () => {
  it('accepts a radius at or under the 2000m building-lookup cap', async () => {
    const dto = plainToInstance(GetPlacesWithBuildingsDto, { lat: 10, lng: 20, radius: 2000 });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('rejects a radius over the 2000m building-lookup cap even though /places allows up to 25000', async () => {
    const dto = plainToInstance(GetPlacesWithBuildingsDto, { lat: 10, lng: 20, radius: 5000 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'radius')).toBe(true);
  });

  it('defaults radius to 1000 when not provided', async () => {
    const dto = plainToInstance(GetPlacesWithBuildingsDto, { lat: 10, lng: 20 });
    expect(dto.radius).toBe(1000);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});
