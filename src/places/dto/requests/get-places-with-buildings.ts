import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { GetPlacesDto } from './get-places.dto';

export class GetPlacesWithBuildingsDto extends GetPlacesDto {

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  match_nearest_building?: boolean = true;

  // Stricter than the base /places radius cap (25000m). The buildings table
  // isn't clustered (see etl/build-buildings-mirror.sql), so both the
  // nearest-building join and a plain buildings scan pay for a much larger
  // scan than /places at the same radius, and cost/latency get materially
  // worse as radius grows. Revisit once BUILDING_TABLE points at a clustered
  // mirror in prod and this has been re-measured.
  @ApiPropertyOptional({
    description: 'Search radius in meters, defaulting to 1000 meters if not provided. Capped lower than /places because building lookups are more expensive per meter of radius.',
    example: 1000,
    minimum: 1,
    maximum: 2000,
    default: 1000,
  })
  @ValidateIf((o) => !o.country)
  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(1)
  @Max(2000, { message: '2000 is the maximum radius for building lookups due to cost. Use /places (max 25000) if you do not need building shapes.' })
  radius?: number = 1000;
}
