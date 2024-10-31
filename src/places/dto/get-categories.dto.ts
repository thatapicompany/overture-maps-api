// src/places/dto/get-brands.dto.ts
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class GetCategoriesDto {
  @IsOptional()
  @IsString()
  @MaxLength(2)
  @MinLength(2)
  country?: string; // ISO 3166 country code

}