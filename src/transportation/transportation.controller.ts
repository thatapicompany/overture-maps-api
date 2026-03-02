import { Controller, Logger, Query, Get, UseGuards } from '@nestjs/common';
import { TransportationService } from './transportation.service';
import { GetTransportationQuery } from './dto/requests/get-transportation-query.dto';
import { TransportationDto, toTransportationDto } from './dto/responses/transportation-response.dto';
import { wrapAsGeoJSON } from '../utils/geojson';
import { Format } from '../common/dto/requests/get-by-location.dto';
import { ApiSecurity, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CountHeader } from '../decorators/count-header.decorator';
import { IsAuthenticatedGuard } from '../guards/is-authenticated.guard';

@ApiTags('Transportation')
@ApiSecurity('API_KEY')
@Controller('transportation')
@UseGuards(IsAuthenticatedGuard)
export class TransportationController {

    logger = new Logger('TransportationController');

    constructor(
        private readonly transportationService: TransportationService,
    ) { }

    @Get()
    @ApiOperation({ summary: 'Get Transportation segments using Query params as filters' })
    @ApiResponse({ status: 200, description: 'Return Transportation segments.', type: TransportationDto, isArray: true })
    @CountHeader()
    async getTransportationSegments(@Query() query: GetTransportationQuery): Promise<TransportationDto[] | any> {

        const segments = await this.transportationService.getTransportationSegments(query);

        const dtoResults = segments.map((segment: any) => toTransportationDto(segment, query));

        if (query.format === Format.GEOJSON) {
            return wrapAsGeoJSON(dtoResults)
        } else {
            return dtoResults
        }
    }

}
