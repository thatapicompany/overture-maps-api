import { ApiProperty } from '@nestjs/swagger';
import { GeometryDto } from '../../../common/dto/responses/geometry.dto';
import { Address } from '../../interfaces/address.interface';
import { GetByLocationDto } from '../../../common/dto/requests/get-by-location.dto';
import { Geometry } from 'geojson';

export class AddressPropertiesDto {
    @ApiProperty({ description: 'The address components', required: false })
    address: string;
    @ApiProperty({ description: 'Postcode', required: false })
    postcode: string;
    @ApiProperty({ description: 'Locality', required: false })
    locality: string;
    @ApiProperty({ description: 'Region', required: false })
    region: string;
    @ApiProperty({ description: 'Country', required: false })
    country: string;
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
