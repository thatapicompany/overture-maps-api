import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GeometryDto {
    @ApiProperty({ description: 'Type of geometry', example: 'Point' })
    type: string;
  
    @ApiProperty({
      description: 'Coordinates representing the geometry.',
      example: [40.7128, -74.0060],
      type: [Number],
    })
    coordinates: number[];
  }