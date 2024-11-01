import { ApiProperty } from "@nestjs/swagger";
import { BrandDto } from "../models/brand.dto";

export class BrandCountsDto {
    @ApiProperty({
      description: 'Number of places where the brand is found',
      example: 100,
    })
    places: number;
  }
export class BrandResponseDto extends BrandDto {

    @ApiProperty({
      description: 'Counts related to the brand e.g. how many Places are associated with it',
      type: () => BrandCountsDto,
    })
    ext_counts: BrandCountsDto;
  
  }
  
  export const toBrandResponseDto = (data) => {
    return new BrandResponseDto(data);
  }
  