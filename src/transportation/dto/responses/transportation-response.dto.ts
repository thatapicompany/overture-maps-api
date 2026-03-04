import { ApiProperty } from '@nestjs/swagger';
import { GeometryDto } from '../../../common/dto/responses/geometry.dto';
import { TransportationSegment } from '../../interfaces/transportation.interface';
import { GetByLocationDto } from '../../../common/dto/requests/get-by-location.dto';
import { Geometry } from 'geojson';

export class TransportationPropertiesDto {
    @ApiProperty({ description: 'Subtype of the segment', required: false })
    subtype?: string;

    @ApiProperty({ description: 'Class of the segment', required: false })
    class?: string;

    @ApiProperty({ description: 'Subclass of the segment', required: false })
    subclass?: string;

    @ApiProperty({ description: 'Names associated with the segment', required: false })
    names?: any;

    @ApiProperty({ description: 'List of connectors', required: false })
    connectors?: any[];

    @ApiProperty({ description: 'Routes', required: false })
    routes?: any[];

    @ApiProperty({ description: 'Subclass rules', required: false })
    subclass_rules?: any[];

    @ApiProperty({ description: 'Access restrictions', required: false })
    access_restrictions?: any[];

    @ApiProperty({ description: 'Level rules', required: false })
    level_rules?: any[];

    @ApiProperty({ description: 'Destinations', required: false })
    destinations?: any[];

    @ApiProperty({ description: 'Prohibited transitions', required: false })
    prohibited_transitions?: any[];

    @ApiProperty({ description: 'Road surface', required: false })
    road_surface?: any[];

    @ApiProperty({ description: 'Road flags', required: false })
    road_flags?: any[];

    @ApiProperty({ description: 'Speed limits', required: false })
    speed_limits?: any[];

    @ApiProperty({ description: 'Width rules', required: false })
    width_rules?: any[];

    @ApiProperty({ description: 'Rail flags', required: false })
    rail_flags?: any[];
}

export class TransportationDto {
    @ApiProperty({ description: 'Unique identifier of the transportation segment.', example: '12345' })
    id: string;

    @ApiProperty({ description: 'Type of segment.', example: 'Feature' })
    type: string;

    @ApiProperty({
        description: 'Geometric representation of the segment.',
        type: () => GeometryDto,
    })
    geometry: Geometry;

    @ApiProperty({
        description: 'Properties and additional details.',
        type: () => TransportationPropertiesDto,
    })
    properties: TransportationPropertiesDto;

    constructor(data: TransportationSegment) {
        this.id = data.id;
        this.type = 'Feature';
        this.geometry = data.geometry;
        if (!this.properties) this.properties = new TransportationPropertiesDto();
    }
}

export const toTransportationDto = (data: any, requestQuery: GetByLocationDto) => {

    const excludeFieldsFromProperties = ['properties', 'geometry', 'ext_distance', 'bbox'];
    const properties = { ...data };
    excludeFieldsFromProperties.forEach(field => delete properties[field]);

    const responseTransportation = new TransportationDto(data)
    responseTransportation.properties = properties as any;
    responseTransportation.geometry = data.geometry;

    if (requestQuery.includes && requestQuery.includes.length > 0) {
        const filteredProperties: any = {};
        requestQuery.includes.forEach((field) => {
            if ((responseTransportation.properties as any)[field] !== undefined) {
                filteredProperties[field] = (responseTransportation.properties as any)[field];
            }
        });
        responseTransportation.properties = filteredProperties;
    }
    return responseTransportation;
}
