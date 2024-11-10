import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, Min, ValidateIf } from 'class-validator';

//format string enums
export enum Format {
  JSON = 'json',
  CSV = 'csv',
  GEOJSON = 'geojson',
}


export class GetByLocationDto {
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
  radius?: number = 1000;

  @ApiPropertyOptional({
    description: 'Limit on the number of results returned, defaulting to 100 if not provided.',
    example: 10,
    minimum: 1,
    default: 100,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  limit?: number = 100;


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

  
  @ApiPropertyOptional({
    description: 'Array of fields to include in the properties field of the response, provided as a comma-separated string. Any fields not in the list will be excluded from the properties object. This is used to make the response lighter so your application is faster.',
    example: ['id', 'geometry', 'properties'],
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => String(value).split(','))
  @IsString({ each: true })
  includes?: string[];
}
