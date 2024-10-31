// src/places/dto/get-places.dto.ts
import { Transform } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Min, ValidateIf } from 'class-validator';

export class GetPlacesDto {
  //convert string to number
  @ValidateIf(o => !o.country)
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  lat: number;

  @ValidateIf(o => !o.country)
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  lng: number;

  @ValidateIf(o => !o.country)
  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(1)
  radius?: number = 1000; // Default radius is 1000 meters if not provided


  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  limit?: number = 100; // Default limit is 10 if not provided
  
  @IsOptional()
  @IsString()
  country?: string; // ISO 3166 country code

  @IsOptional()
  @IsString()
  brand_wikidata?: string; // Wikidata brand ID

  @IsOptional()
  @IsString()
  brand_name?: string; // Wikidata brand ID

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  min_confidence?: number = 0.5;


  //transform into an array of strings
  @IsOptional()
  @Transform(({ value }) => String(value).split(','))
  @IsString({ each: true })
  categories?: string[]; // Array of category names

  //json by default csv or geojson
  @IsOptional()
  @IsString()
  @IsIn(['json', 'csv', 'geojson'])
  format?: string = 'json';
}
