// src/places/dto/get-brands.dto.ts
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class GetBrandsDto {
  @IsOptional()
  @IsString()
  @MaxLength(2)
  @MinLength(2)
  country?: string; // ISO 3166 country code

  @ValidateIf(o => !o.country)
  @IsNumber()
  lat?: number;

  @ValidateIf(o => !o.country)
  @IsNumber()
  lng?: number;

  @ValidateIf(o => !o.country)
  @IsOptional()
  @IsNumber()
  @Min(1)
  radius?: number = 1000; // Default radius is 1000 meters if not provided

  //transform into an array of strings
  @IsOptional()
  @Transform(({ value }) => String(value).split(','))
  @IsString({ each: true })
  categories?: string[]; // Array of category names
}