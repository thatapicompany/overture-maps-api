
import { ApiProperty } from '@nestjs/swagger';
import { Brand, Place } from '../../interfaces/place.interface';
export class CountryCountsDto {
  @ApiProperty({
    description: 'Number of places in this Country',
    example: 100,
  })
  places: number;

  @ApiProperty({
    description: 'Number of brands that are associated with the Country',
    example: 10,
  })
  brands: number;
}

export class CountryResponseDto {
  @ApiProperty({ description: 'The ISO code of the Country.', example: 'US' })
  country: string;
  
  @ApiProperty({
    description: 'Counts related to the Country e.g. how many Places and Brands are associated with it',
    type: () => CountryCountsDto,
  })
  ext_counts: {
    places: number;
    brands: number;
  }

  constructor(data: Brand) {
    
    Object.assign(this, data);
    
  }
};

export const toCountryResponseDto = (data) => {
  return new CountryResponseDto(data);
}
