import { Controller, Logger, Query, Get, UseGuards } from '@nestjs/common';
import { requirePoint } from '../common/require-point';
import { TransportationService } from './transportation.service';
import { GetTransportationQuery } from './dto/requests/get-transportation-query.dto';
import { TransportationDto, toTransportationDto } from './dto/responses/transportation-response.dto';
import { wrapAsGeoJSON } from '../utils/geojson';
import { Format } from '../common/dto/requests/get-by-location.dto';
import { ApiSecurity, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiStandardErrors, PAGINATION_HEADERS } from '../openapi/openapi.decorators';
import { CountHeader } from '../decorators/count-header.decorator';
import { IsAuthenticatedGuard } from '../guards/is-authenticated.guard';
import { DemoLocationGuard } from '../guards/demo-location.guard';

@ApiTags('Transportation')
@ApiSecurity('API_KEY')
@ApiStandardErrors()
@Controller('transportation')
@UseGuards(IsAuthenticatedGuard, DemoLocationGuard)
export class TransportationController {

    logger = new Logger('TransportationController');

    constructor(
        private readonly transportationService: TransportationService,
    ) { }

    @Get()
    @ApiOperation({
    operationId: "searchTransportationSegments",
    summary: "Search transportation segments",
    description: "Find road, rail and path segments within `radius` metres of a `lat`/`lng`. A location is required.",
  })
    @ApiResponse({ status: 200, description: 'Return Transportation segments.', type: TransportationDto, isArray: true, headers: PAGINATION_HEADERS })
    @CountHeader()
    async getTransportationSegments(@Query() query: GetTransportationQuery): Promise<TransportationDto[] | any> {
    requirePoint(query, '/transportation');

        const { results, totalCount } = await this.transportationService.getTransportationSegments(query);

        const dtoResults = results.map((segment: any) => toTransportationDto(segment, query));

        // The PaginationInterceptor unwraps this envelope: clients receive the
        // same array/GeoJSON body as always, with Pagination-* headers added.
        return { results: dtoResults, totalCount, page: query.page ?? 0, limit: query.limit };
    }

}
