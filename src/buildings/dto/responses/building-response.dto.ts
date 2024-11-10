import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GeometryDto } from '../../../common/dto/responses/geometry.dto';
import { Building } from '../../interfaces/building.interface';
import { GetByLocationDto } from 'src/common/dto/requests/get-by-location.dto';
import { Geometry } from 'geojson';

export class BuildingPropertiesDto {

}

export class BuildingDto {
    @ApiProperty({ description: 'Unique identifier of the place.', example: '12345' })
    id: string;
  
    @ApiProperty({ description: 'Type of place or feature.', example: 'Point of Interest' })
    type: string;
  
    @ApiProperty({
      description: 'Geometric representation of the place.',
      type: () => GeometryDto,
    })
    geometry: Geometry;
  
    @ApiProperty({
        description: 'Properties and additional details.',
        type: () => BuildingPropertiesDto,
      })
      properties: BuildingPropertiesDto;

    constructor(data: Building) {
      this.id = data.id;
      this.geometry = data.geometry;
      if(!this.properties) this.properties = new BuildingPropertiesDto();
      //Object.assign(this, data);
    }
  }
  
export const toBuildingDto = (data , requestQuery:GetByLocationDto) => {

  const excludeFieldsFromProperties = ['properties','geometry','ext_distance','bbox'];
  const properties = {...data};
  excludeFieldsFromProperties.forEach(field => delete properties[field]);

  const rPlace =  new BuildingDto(data)
  rPlace.properties = properties;
  rPlace.geometry = data.geometry;
    
  //remove any fields that are not requested
    if(requestQuery.includes && requestQuery.includes.length > 0) {
        const filteredProperties = {};
        requestQuery.includes.forEach((field) => {

            if(rPlace.properties[field]) {
                filteredProperties[field] = rPlace.properties[field];
            }
        });
        rPlace.properties = filteredProperties;
    }
    return rPlace
}