
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

  @ApiPropertyOptional({ description: 'Wikidata QID of the brand.', example: 'Q37158' })
  wikidata?: string;

  @ApiPropertyOptional({ description: 'Brand logo URL (Wikimedia Commons, resizable with ?width=N). Sourced from Wikidata (CC0).', example: 'http://commons.wikimedia.org/wiki/Special:FilePath/Starbucks%20coffee%20wordmark.png' })
  ext_logo_url?: string;

  @ApiPropertyOptional({ description: 'Official brand website. Sourced from Wikidata (CC0).', example: 'https://www.starbucks.com/' })
  ext_website?: string;

  @ApiPropertyOptional({ description: 'Industry of the brand. Sourced from Wikidata (CC0).', example: 'coffee industry' })
  ext_industry?: string;

  @ApiPropertyOptional({ description: 'Parent organisation of the brand. Sourced from Wikidata (CC0).', example: 'Starbucks Corporation' })
  ext_parent?: string;

  @ApiPropertyOptional({ description: 'English label of the brand on Wikidata (CC0).', example: 'Starbucks' })
  ext_wikidata_label?: string;

  constructor(data: Brand) {
    Object.assign(this, data);
  }
}
