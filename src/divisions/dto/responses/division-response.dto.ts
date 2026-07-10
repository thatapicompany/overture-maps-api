import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GeometryDto } from '../../../common/dto/responses/geometry.dto';
import { DivisionArea } from '../../interfaces/division.interface';
import { GetByLocationDto } from '../../../common/dto/requests/get-by-location.dto';
import { Geometry } from 'geojson';

export class DivisionBboxDto {
    @ApiProperty({ description: 'Minimum longitude', example: -74.3 })
    xmin: number;
    @ApiProperty({ description: 'Maximum longitude', example: -73.7 })
    xmax: number;
    @ApiProperty({ description: 'Minimum latitude', example: 40.5 })
    ymin: number;
    @ApiProperty({ description: 'Maximum latitude', example: 40.9 })
    ymax: number;
}

export class DivisionPropertiesDto {
    @ApiProperty({ description: 'Subtype of the division', required: false })
    subtype: string;
    @ApiProperty({ description: 'Class of the division', required: false })
    class: string;
    @ApiPropertyOptional({ description: 'Primary name of the division', example: 'City of Westminster' })
    primary_name?: string;
    @ApiPropertyOptional({ description: 'Names of the division, including common names keyed by language code' })
    names?: { primary?: string; common?: Record<string, string> };
    @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 country code', example: 'GB' })
    country?: string;
    @ApiPropertyOptional({ description: 'ISO 3166-2 region code', example: 'GB-WSM' })
    region?: string;
    @ApiPropertyOptional({ description: 'Position of the division in its country\'s hierarchy, e.g. 0 (country), 1, 2.', example: 2 })
    admin_level?: number;
    @ApiPropertyOptional({ description: 'Whether the area represents land (vs maritime).', example: true })
    is_land?: boolean;
    @ApiPropertyOptional({ description: 'Whether the area includes territorial waters.', example: false })
    is_territorial?: boolean;
    @ApiPropertyOptional({ description: 'ID of the division feature this area belongs to.' })
    division_id?: string;
    @ApiPropertyOptional({ description: 'Set when this record\'s own geometry is missing upstream and the boundary was served from a sibling area of the same division; the value is the sibling\'s class, e.g. "maritime" (land plus territorial waters).', example: 'maritime' })
    ext_geometry_source?: string;
}

export class DivisionDto {
    @ApiProperty({ description: 'Unique identifier of the division area.', example: '12345' })
    id: string;

    @ApiProperty({ description: 'Type of division.', example: 'division_area' })
    type: string;

    @ApiPropertyOptional({
        description: 'Bounding box of the division area.',
        type: () => DivisionBboxDto,
    })
    bbox?: DivisionBboxDto;

    @ApiPropertyOptional({
        description: 'Geometric representation of the division area. Omitted when include_geometry resolves to false; fetch it via GET /divisions/{id}.',
        type: () => GeometryDto,
    })
    geometry?: Geometry;

    @ApiProperty({
        description: 'Properties and additional details.',
        type: () => DivisionPropertiesDto,
    })
    properties: DivisionPropertiesDto;

    constructor(data: DivisionArea) {
        this.id = data.id;
        this.geometry = data.geometry;
        this.bbox = data.bbox;
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
