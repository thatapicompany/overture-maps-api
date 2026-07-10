import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';
import { GetByLocationDto } from '../../../common/dto/requests/get-by-location.dto';

export class GetPlacesDto extends GetByLocationDto {


  @ApiPropertyOptional({
    description: 'Filter places to only those with a source dataset matching this value.',
    example: 'meta',
  })
  @IsOptional()
  @IsString()
  source?: string;
  @ApiProperty({
    description: 'Latitude coordinate. Required if country code is not provided.',
    example: 40.7128,
  })
  @ValidateIf(o => !o.country)
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  lat: number;

  @ApiProperty({
    description: 'Longitude coordinate. Required if country code is not provided.',
    example: -74.0060,
  })
  @ValidateIf(o => !o.country)
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  lng: number;

  @ApiPropertyOptional({
    description: 'Search radius in meters, defaulting to 1000 meters if not provided.',
    example: 1000,
    minimum: 1,
    default: 1000,
  })
  @ValidateIf(o => !o.country)
  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(1)
  @Max(25000, { message: '25000 is the maximum on your plan. Increase plan or request data at a country level' })
  radius?: number = 1000;

  @ApiPropertyOptional({
    description: 'ISO 3166 country code consisting of 2 characters. Required if lat/lng are not provided.',
    example: 'US',
  })
  @IsOptional()
  @IsString()
  country?: string;




  @ApiPropertyOptional({
    description: 'Wikidata brand ID associated with the place.',
    example: 'Q12345',
  })
  @IsOptional()
  @IsString()
  brand_wikidata?: string;

  @ApiPropertyOptional({
    description: 'Brand name associated with the place.',
    example: 'Starbucks',
  })
  @IsOptional()
  @IsString()
  brand_name?: string;

  @ApiPropertyOptional({
    description: 'Minimum confidence score for the places to be returned, defaulting to 0.5 if not provided.',
    example: 0.5,
    default: 0.5,
  })
  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  min_confidence?: number = 0.5;

  @ApiPropertyOptional({
    description: 'Array of category names, provided as a comma-separated string. Matches the legacy Overture categories vocabulary and the newer taxonomy/basic_category vocabulary.',
    example: 'food,retail',
    type: String
  })
  @IsOptional()
  @Transform((params) => String(params.value).split(',').map(String))
  categories?: string[];

  @ApiPropertyOptional({
    description: 'Array of Overture taxonomy categories, provided as a comma-separated string. Matches the primary category or any ancestor in the taxonomy hierarchy, so e.g. "food_and_drink" matches every descendant category.',
    example: 'food_and_drink',
    type: String
  })
  @IsOptional()
  @Transform((params) => String(params.value).split(',').map((s) => s.trim()).filter(Boolean))
  taxonomy?: string[];

  @ApiPropertyOptional({
    description: 'Filter by operating status, e.g. "open" or "permanently_closed". Places without signals have a null operating status and are excluded when this filter is used.',
    example: 'open',
  })
  @IsOptional()
  @IsString()
  operating_status?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated list of enrichment fields to include. Use "brand" for Wikidata-sourced brand details (logo, website, industry, parent) on branded places.',
    example: 'brand',
    type: String,
  })
  @IsOptional()
  @Transform((params) => String(params.value).split(',').map((s) => s.trim()))
  enrichment_fields?: string[];

  @ApiPropertyOptional({
    description: 'Response format, defaulting to JSON. Options are "json", "csv", or "geojson".',
    example: 'json',
    default: 'json',
    enum: ['json', 'csv', 'geojson'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['json', 'csv', 'geojson'])
  format?: string = 'json';
}
