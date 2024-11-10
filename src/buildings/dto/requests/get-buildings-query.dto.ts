import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { GetByLocationDto } from '../../../common/dto/requests/get-by-location.dto';

export class GetBuildingsQuery extends GetByLocationDto {


}
