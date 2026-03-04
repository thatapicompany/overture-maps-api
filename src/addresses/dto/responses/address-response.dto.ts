import { ApiProperty } from '@nestjs/swagger';
import { GeometryDto } from '../../../common/dto/responses/geometry.dto';
import { Address } from '../../interfaces/address.interface';
import { GetByLocationDto } from '../../../common/dto/requests/get-by-location.dto';
import { Geometry } from 'geojson';

export class AddressPropertiesDto {
    @ApiProperty({ description: 'Country', required: false })
    country?: string;

    @ApiProperty({ description: 'Postcode', required: false })
    postcode?: string;

    @ApiProperty({ description: 'Street name', required: false })
    street?: string;

    @ApiProperty({ description: 'Street number', required: false })
    number?: string;

    @ApiProperty({ description: 'Unit number', required: false })
    unit?: string;

    @ApiProperty({ description: 'Address levels (e.g., state, city)', required: false, isArray: true, type: String })
    address_levels?: string[];

    @ApiProperty({ description: 'Postal city', required: false })
    postal_city?: string;
}

export class AddressDto {
    @ApiProperty({ description: 'Unique identifier of the address.', example: '12345' })
    id: string;

    @ApiProperty({ description: 'Type of place or feature.', example: 'Address' })
    type: string;

    @ApiProperty({
        description: 'Geometric representation of the address.',
        type: () => GeometryDto,
    })
    geometry: Geometry;

    @ApiProperty({
        description: 'Properties and additional details.',
        type: () => AddressPropertiesDto,
    })
    properties: AddressPropertiesDto;

    constructor(data: Address) {
        this.id = data.id;
        this.type = 'Feature';
        this.geometry = data.geometry;
        if (!this.properties) this.properties = new AddressPropertiesDto();
    }
}

export const toAddressDto = (data: any, requestQuery: GetByLocationDto) => {

    const excludeFieldsFromProperties = ['properties', 'geometry', 'ext_distance', 'bbox'];
    const properties = { ...data };
    excludeFieldsFromProperties.forEach(field => delete properties[field]);

    const responseAddress = new AddressDto(data)
    responseAddress.properties = properties as any;
    responseAddress.geometry = data.geometry;

    if (requestQuery.includes && requestQuery.includes.length > 0) {
        const filteredProperties: any = {};
        requestQuery.includes.forEach((field) => {
            if ((responseAddress.properties as any)[field] !== undefined) {
                filteredProperties[field] = (responseAddress.properties as any)[field];
            }
        });
        responseAddress.properties = filteredProperties;
    }
    return responseAddress;
}
