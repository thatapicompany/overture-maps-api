import { ApiProperty } from "@nestjs/swagger";
import { CategoryDto } from "../models/category.dto";

export class CategoryCountsDto {
    @ApiProperty({
      description: 'Number of places with this Category',
      example: 100,
    })
    places: number;

    @ApiProperty({
      description: 'Number of brands that are associated with the Categorys',
      example: 10,
    })
    brands: number;
  }
export class CategoryResponseDto extends CategoryDto {
    @ApiProperty({
      description: 'Counts related to the Category e.g. how many Places and Brands are associated with it',
      type: () => CategoryCountsDto,
    })
    ext_counts: {
      places: number;
      brands: number;
    }
  
  };
  export const toCategoryResponseDto = (data) => {
    return new CategoryResponseDto(data);
  }
  