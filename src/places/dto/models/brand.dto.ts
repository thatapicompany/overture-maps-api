
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Brand, Place } from '../../interfaces/place.interface';


export class BrandRulesDto {
  @ApiProperty({ description: 'Variant of the rule.', example: 'Abbreviation' })
  variant: string;

  @ApiProperty({ description: 'Value associated with the rule.', example: 'CP' })
  value: string;
}

export class BrandNamesDto {
  @ApiProperty({ description: 'Primary name of the place.', example: 'Central Park' })
  primary: string;

  @ApiPropertyOptional({ description: 'Common names in different languages.', type: 'object', example: { en: 'Central Park', es: 'Parque Central' } ,properties: {}})
  common?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Naming rules or variants associated with the place.',
    type: [BrandRulesDto],
  })
  rules?: BrandRulesDto[];
}


export class BrandDto {
  @ApiProperty({
    description: 'Names associated with the brand, usually Primary is the most useful',
    type: () => BrandNamesDto,
  })
  names: BrandNamesDto;


  constructor(data: Brand) {
    Object.assign(this, data);
  }
}
