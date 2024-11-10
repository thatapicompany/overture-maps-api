import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { GetByLocationDto } from 'src/common/dto/requests/get-by-location.dto';
import { GetPlacesDto } from './get-places.dto';
import { Optional } from '@nestjs/common';

export class GetPlacesWithBuildingsDto extends GetPlacesDto {
  
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  match_nearest_building?: boolean;

}
