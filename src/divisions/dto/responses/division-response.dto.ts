import { ApiProperty } from '@nestjs/swagger';
import { GeometryDto } from '../../../common/dto/responses/geometry.dto';
import { DivisionArea } from '../../interfaces/division.interface';
import { GetByLocationDto } from '../../../common/dto/requests/get-by-location.dto';
import { Geometry } from 'geojson';

export class DivisionPropertiesDto {
    @ApiProperty({ description: 'Subtype of the division', required: false })
    subtype: string;
    @ApiProperty({ description: 'Class of the division', required: false })
    class: string;
}

export class DivisionDto {
    @ApiProperty({ description: 'Unique identifier of the division area.', example: '12345' })
    id: string;

    @ApiProperty({ description: 'Type of division.', example: 'division_area' })
    type: string;

    @ApiProperty({
        description: 'Geometric representation of the division area.',
        type: () => GeometryDto,
    })
    geometry: Geometry;

    @ApiProperty({
        description: 'Properties and additional details.',
        type: () => DivisionPropertiesDto,
    })
    properties: DivisionPropertiesDto;

    constructor(data: DivisionArea) {
        this.id = data.id;
        this.geometry = data.geometry;
        if (!this.properties) this.properties = new DivisionPropertiesDto();
    }
}

export const toDivisionDto = (data: any, requestQuery: GetByLocationDto) => {

    const excludeFieldsFromProperties = ['properties', 'geometry', 'ext_distance', 'bbox'];
    const properties = { ...data };
    excludeFieldsFromProperties.forEach(field => delete properties[field]);

    const responseDivision = new DivisionDto(data)
    responseDivision.properties = properties as any;
    responseDivision.geometry = data.geometry;

    if (requestQuery.includes && requestQuery.includes.length > 0) {
        const filteredProperties: any = {};
        requestQuery.includes.forEach((field) => {
            if ((responseDivision.properties as any)[field] !== undefined) {
                filteredProperties[field] = (responseDivision.properties as any)[field];
            }
        });
        responseDivision.properties = filteredProperties;
    }
    return responseDivision;
}
