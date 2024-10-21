// src/places/dto/get-brands.dto.ts
import { IsNumber, IsOptional, IsString, Min, ValidateIf } from 'class-validator';

export class GetBrandsDto {
  @IsOptional()
  @IsString()
  country_code?: string; // ISO 3166 country code

  @ValidateIf(o => !o.country_code)
  @IsNumber()
  lat?: number;

  @ValidateIf(o => !o.country_code)
  @IsNumber()
  lng?: number;

  @ValidateIf(o => !o.country_code)
  @IsOptional()
  @IsNumber()
  @Min(1)
  radius?: number = 1000; // Default radius is 1000 meters if not provided
}