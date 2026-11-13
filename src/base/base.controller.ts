import { Controller, Logger, Query, Get, UseGuards } from '@nestjs/common';
import { requirePoint } from '../common/require-point';
import { BaseService } from './base.service';
import { GetBaseQuery } from './dto/requests/get-base-query.dto';
import { BaseDto, toBaseDto } from './dto/responses/base-response.dto';
import { wrapAsGeoJSON } from '../utils/geojson';
import { Format } from '../common/dto/requests/get-by-location.dto';
import { ApiSecurity, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiStandardErrors, PAGINATION_HEADERS } from '../openapi/openapi.decorators';
import { CountHeader } from '../decorators/count-header.decorator';
import { IsAuthenticatedGuard } from '../guards/is-authenticated.guard';
import { DemoLocationGuard } from '../guards/demo-location.guard';

@ApiTags('Base')
@ApiSecurity('API_KEY')
@ApiStandardErrors()
@Controller('base')
@UseGuards(IsAuthenticatedGuard, DemoLocationGuard)
export class BaseController {

    logger = new Logger('BaseController');

    constructor(
        private readonly baseService: BaseService,
    ) { }

    @Get()
    @ApiOperation({
    operationId: "searchBaseFeatures",
    summary: "Search base map features",
    description: "Find base map features (land use, land cover, water and similar) within `radius` metres of a `lat`/`lng`. A location is required.",
  })
    @ApiResponse({ status: 200, description: 'Return Base features.', type: BaseDto, isArray: true, headers: PAGINATION_HEADERS })
    @CountHeader()
    async getBaseFeatures(@Query() query: GetBaseQuery): Promise<BaseDto[] | any> {
    requirePoint(query, '/base');

        const { results, totalCount } = await this.baseService.getBaseFeatures(query);

        const dtoResults = results.map((feature: any) => toBaseDto(feature, query));

        // The PaginationInterceptor unwraps this envelope: clients receive the
        // same array/GeoJSON body as always, with Pagination-* headers added.
        return { results: dtoResults, totalCount, page: query.page ?? 0, limit: query.limit };
    }

}
