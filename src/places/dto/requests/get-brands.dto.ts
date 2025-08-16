import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { GetByLocationDto } from '../../../common/dto/requests/get-by-location.dto';

export class GetBrandsDto extends GetByLocationDto{

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
