import { ApiProperty } from '@nestjs/swagger';
import { GeometryDto } from '../../../common/dto/responses/geometry.dto';
import { BaseFeature } from '../../interfaces/base.interface';
import { GetByLocationDto } from '../../../common/dto/requests/get-by-location.dto';
import { Geometry } from 'geojson';

export class BasePropertiesDto {
    @ApiProperty({ description: 'Subtype of the feature', required: false })
    subtype: string;
    @ApiProperty({ description: 'Class of the feature', required: false })
    class: string;
}

export class BaseDto {
    @ApiProperty({ description: 'Unique identifier of the base feature.', example: '12345' })
    id: string;

    @ApiProperty({ description: 'Type of feature.', example: 'landUse' })
    type: string;

    @ApiProperty({
        description: 'Geometric representation of the base feature.',
        type: () => GeometryDto,
    })
    geometry: Geometry;

    @ApiProperty({
        description: 'Properties and additional details.',
        type: () => BasePropertiesDto,
    })
    properties: BasePropertiesDto;

    constructor(data: BaseFeature) {
        this.id = data.id;
        this.geometry = data.geometry;
        if (!this.properties) this.properties = new BasePropertiesDto();
    }
}

export const toBaseDto = (data: any, requestQuery: GetByLocationDto) => {

    const excludeFieldsFromProperties = ['properties', 'geometry', 'ext_distance', 'bbox'];
    const properties = { ...data };
    excludeFieldsFromProperties.forEach(field => delete properties[field]);

    const responseBase = new BaseDto(data)
    responseBase.properties = properties as any;
    responseBase.geometry = data.geometry;

    if (requestQuery.includes && requestQuery.includes.length > 0) {
        const filteredProperties: any = {};
        requestQuery.includes.forEach((field) => {
            if ((responseBase.properties as any)[field] !== undefined) {
                filteredProperties[field] = (responseBase.properties as any)[field];
            }
        });
        responseBase.properties = filteredProperties;
    }
    return responseBase;
}
