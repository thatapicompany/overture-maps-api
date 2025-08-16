import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetPlacesDto } from './get-places.dto';

describe('GetPlacesDto', () => {
  it('should validate required fields', async () => {
    const dto = plainToInstance(GetPlacesDto, { lat: 10, lng: 20 });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail validation if lat is missing', async () => {
    const dto = plainToInstance(GetPlacesDto, { lng: 20 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
