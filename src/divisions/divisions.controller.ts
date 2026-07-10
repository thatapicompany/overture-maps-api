import { Controller, Logger, Query, Get, Param, NotFoundException, UseGuards } from '@nestjs/common';
import { DivisionsService } from './divisions.service';
import { GetDivisionsQuery } from './dto/requests/get-divisions-query.dto';
import { DivisionDto, toDivisionDto } from './dto/responses/division-response.dto';
import { wrapAsGeoJSON } from '../utils/geojson';
import { Format } from '../common/dto/requests/get-by-location.dto';
import { ApiSecurity, ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CountHeader } from '../decorators/count-header.decorator';
import { IsAuthenticatedGuard } from '../guards/is-authenticated.guard';
import { DemoLocationGuard } from '../guards/demo-location.guard';

@ApiTags('Divisions')
@ApiSecurity('API_KEY')
@Controller('divisions')
@UseGuards(IsAuthenticatedGuard, DemoLocationGuard)
export class DivisionsController {

    logger = new Logger('DivisionsController');

    constructor(
        private readonly divisionsService: DivisionsService,
    ) { }

    @Get()
    @ApiOperation({ summary: 'Get Division areas using Query params as filters' })
    @ApiResponse({ status: 200, description: 'Return Division areas.', type: DivisionDto, isArray: true })
    @CountHeader()
    async getDivisions(@Query() query: GetDivisionsQuery): Promise<DivisionDto[] | any> {

        const { results, totalCount } = await this.divisionsService.getDivisions(query);

        const dtoResults = results.map((division: any) => toDivisionDto(division, query));

        // The PaginationInterceptor unwraps this envelope: clients receive the
        // same array/GeoJSON body as always, with Pagination-* headers added.
        return { results: dtoResults, totalCount, page: query.page ?? 0, limit: query.limit };
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get a single Division area by ID, including its full polygon geometry' })
    @ApiParam({ name: 'id', description: 'Overture division area ID', example: '0850b45bffffffff01c3320da9d5f43d' })
    @ApiResponse({ status: 200, description: 'Return the Division area.', type: DivisionDto })
    @ApiResponse({ status: 404, description: 'Division area not found.' })
    async getDivisionById(@Param('id') id: string): Promise<DivisionDto> {

        const division = await this.divisionsService.getDivisionById(id);

        if (!division) {
            throw new NotFoundException(`No division area found with id "${id}"`);
        }

        return toDivisionDto(division, {} as GetDivisionsQuery);
    }

}
