import { Controller, Logger, Query, Get, UseGuards } from '@nestjs/common';
import { DivisionsService } from './divisions.service';
import { GetDivisionsQuery } from './dto/requests/get-divisions-query.dto';
import { DivisionDto, toDivisionDto } from './dto/responses/division-response.dto';
import { wrapAsGeoJSON } from '../utils/geojson';
import { Format } from '../common/dto/requests/get-by-location.dto';
import { ApiSecurity, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CountHeader } from '../decorators/count-header.decorator';
import { IsAuthenticatedGuard } from '../guards/is-authenticated.guard';

@ApiTags('Divisions')
@ApiSecurity('API_KEY')
@Controller('divisions')
@UseGuards(IsAuthenticatedGuard)
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

        const divisions = await this.divisionsService.getDivisions(query);

        const dtoResults = divisions.map((division: any) => toDivisionDto(division, query));

        if (query.format === Format.GEOJSON) {
            return wrapAsGeoJSON(dtoResults)
        } else {
            return dtoResults
        }
    }

}
