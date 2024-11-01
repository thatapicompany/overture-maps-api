
import { ApiProperty } from '@nestjs/swagger';

export class CategoryDto {
  @ApiProperty({ description: 'Primary category of the place.', example: 'Retail' })
  primary: string;

  constructor(data) {
    
    Object.assign(this, data);
    
  }
}
