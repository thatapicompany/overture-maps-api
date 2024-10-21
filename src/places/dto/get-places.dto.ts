// src/places/dto/get-places.dto.ts
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class GetPlacesDto {
  //convert string to number
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  lat: number;

  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  lng: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(1)
  radius?: number = 1000; // Default radius is 1000 meters if not provided

  @IsOptional()
  @IsString()
  wikidata?: string; // Wikidata brand ID

  @IsOptional()
  @IsString()
  country?: string; // ISO 3166 country code
}
