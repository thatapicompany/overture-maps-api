import { Controller, Logger, Query, Get, Param, NotFoundException, UseGuards } from '@nestjs/common';
import { DivisionsService } from './divisions.service';
import { GetDivisionsQuery } from './dto/requests/get-divisions-query.dto';
import { DivisionDto, toDivisionDto } from './dto/responses/division-response.dto';
import { wrapAsGeoJSON } from '../utils/geojson';
import { Format } from '../common/dto/requests/get-by-location.dto';
import { ApiSecurity, ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ApiStandardErrors, ErrorResponseDto, PAGINATION_HEADERS } from '../openapi/openapi.decorators';
import { CountHeader } from '../decorators/count-header.decorator';
import { IsAuthenticatedGuard } from '../guards/is-authenticated.guard';
import { DemoLocationGuard } from '../guards/demo-location.guard';
import { AuthedUser, User } from '../decorators/authed-user.decorator';
import { checkDemoDivisionsScope } from './demo-divisions-scope';

@ApiTags('Divisions')
@ApiSecurity('API_KEY')
@ApiStandardErrors()
@Controller('divisions')
@UseGuards(IsAuthenticatedGuard, DemoLocationGuard)
export class DivisionsController {

    logger = new Logger('DivisionsController');

    constructor(
        private readonly divisionsService: DivisionsService,
    ) { }

    @Get()
    @ApiOperation({
    operationId: "searchDivisions",
    summary: "Search administrative areas",
    description: "Find countries, regions, localities and neighbourhoods by `name`, `country`, `subtype` or `admin_level`, or those containing or near a `lat`/`lng`. Use it to geocode a place name to a point or boundary before searching `/places`. Name searches omit boundary geometry by default (set `include_geometry=true`, or fetch one area with `GET /divisions/{id}`), because polygons can be megabytes each.",
  })
    @ApiResponse({ status: 200, description: 'Return Division areas.', type: DivisionDto, isArray: true, headers: PAGINATION_HEADERS })
    @CountHeader()
    async getDivisions(@Query() query: GetDivisionsQuery, @AuthedUser() user: User): Promise<DivisionDto[] | any> {

        // Demo key: points near a demo city, or name searches without geometry
        checkDemoDivisionsScope(query, query.resolveIncludeGeometry(), user);

        const { results, totalCount } = await this.divisionsService.getDivisions(query);

        const dtoResults = results.map((division: any) => toDivisionDto(division, query));

        // The PaginationInterceptor unwraps this envelope: clients receive the
        // same array/GeoJSON body as always, with Pagination-* headers added.
        return { results: dtoResults, totalCount, page: query.page ?? 0, limit: query.limit };
    }

    @Get(':id')
    @ApiOperation({
    operationId: "getDivision",
    summary: "Get an administrative area by ID",
    description: "Fetch one division area by its Overture ID, including its full boundary polygon. Use an ID returned by `GET /divisions`.",
  })
    @ApiParam({ name: 'id', description: 'Overture division area ID', example: '0850b45bffffffff01c3320da9d5f43d' })
    @ApiResponse({ status: 200, description: 'Return the Division area.', type: DivisionDto })
    @ApiResponse({ status: 404, description: 'Division area not found.', type: ErrorResponseDto })
    async getDivisionById(@Param('id') id: string): Promise<DivisionDto> {

        const division = await this.divisionsService.getDivisionById(id);

        if (!division) {
            throw new NotFoundException(`No division area found with id "${id}"`);
        }

        return toDivisionDto(division, {} as GetDivisionsQuery);
    }

}
