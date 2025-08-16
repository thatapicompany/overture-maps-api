import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { GetByLocationDto } from '../../../common/dto/requests/get-by-location.dto';

export class GetCategoriesDto extends GetByLocationDto {
  @ApiPropertyOptional({
    description: 'ISO 3166 country code consisting of 2 characters.',
    example: 'US',
    maxLength: 2,
    minLength: 2,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  @MinLength(2)
  country?: string; // ISO 3166 country code
}
