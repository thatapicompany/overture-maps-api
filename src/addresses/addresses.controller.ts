import { Controller, Logger, Query, Get, UseGuards } from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { GetAddressesQuery } from './dto/requests/get-addresses-query.dto';
import { AddressDto, toAddressDto } from './dto/responses/address-response.dto';
import { wrapAsGeoJSON } from '../utils/geojson';
import { Format } from '../common/dto/requests/get-by-location.dto';
import { ApiSecurity, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CountHeader } from '../decorators/count-header.decorator';
import { IsAuthenticatedGuard } from '../guards/is-authenticated.guard';

@ApiTags('Addresses')
@ApiSecurity('API_KEY')
@Controller('addresses')
@UseGuards(IsAuthenticatedGuard)
export class AddressesController {

    logger = new Logger('AddressesController');

    constructor(
        private readonly addressesService: AddressesService,
    ) { }

    @Get()
    @ApiOperation({ summary: 'Get Addresses using Query params as filters' })
    @ApiResponse({ status: 200, description: 'Return Addresses.', type: AddressDto, isArray: true })
    @CountHeader()
    async getAddresses(@Query() query: GetAddressesQuery): Promise<AddressDto[] | any> {

        const addresses = await this.addressesService.getAddresses(query);

        const dtoResults = addresses.map((address: any) => toAddressDto(address, query));

        if (query.format === Format.GEOJSON) {
            return wrapAsGeoJSON(dtoResults)
        } else {
            return dtoResults
        }
    }

}
