import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class GetBrandsDto {
  @ApiPropertyOptional({
    description: 'ISO 3166 country code consisting of 2 characters. Required if lat/lng are not provided.',
    example: 'US',
    maxLength: 2,
    minLength: 2,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  @MinLength(2)
  country?: string; // ISO 3166 country code

  @ApiPropertyOptional({
    description: 'Latitude coordinate. Required if country code is not provided.',
    example: 40.7128,
  })
  @ValidateIf(o => !o.country)
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional({
    description: 'Longitude coordinate. Required if country code is not provided.',
    example: -74.0060,
  })
  @ValidateIf(o => !o.country)
  @IsNumber()
  lng?: number;

  @ApiPropertyOptional({
    description: 'Search radius in meters, defaulting to 1000 meters if not provided.',
    example: 1000,
    minimum: 1,
    default: 1000,
  })
  @ValidateIf(o => !o.country)
  @IsOptional()
  @IsNumber()
  @Min(1)
  radius?: number = 1000; // Default radius is 1000 meters if not provided

  @ApiPropertyOptional({
    description: 'Array of category names, provided as a comma-separated string.',
    example: ['food', 'retail'],
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => String(value).split(','))
  @IsString({ each: true })
  categories?: string[]; // Array of category names
}
