import { Controller, Logger, Query, Get, UseGuards } from '@nestjs/common';
import { BaseService } from './base.service';
import { GetBaseQuery } from './dto/requests/get-base-query.dto';
import { BaseDto, toBaseDto } from './dto/responses/base-response.dto';
import { wrapAsGeoJSON } from '../utils/geojson';
import { Format } from '../common/dto/requests/get-by-location.dto';
import { ApiSecurity, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CountHeader } from '../decorators/count-header.decorator';
import { IsAuthenticatedGuard } from '../guards/is-authenticated.guard';
import { DemoLocationGuard } from '../guards/demo-location.guard';

@ApiTags('Base')
@ApiSecurity('API_KEY')
@Controller('base')
@UseGuards(IsAuthenticatedGuard, DemoLocationGuard)
export class BaseController {

    logger = new Logger('BaseController');

    constructor(
        private readonly baseService: BaseService,
    ) { }

    @Get()
    @ApiOperation({ summary: 'Get Base features using Query params as filters' })
    @ApiResponse({ status: 200, description: 'Return Base features.', type: BaseDto, isArray: true })
    @CountHeader()
    async getBaseFeatures(@Query() query: GetBaseQuery): Promise<any> {

        const { results, totalCount } = await this.baseService.getBaseFeatures(query);

        const dtoResults = results.map((feature: any) => toBaseDto(feature, query));

        return {
            results: dtoResults,
            totalCount,
            page: query.page ?? 0,
            limit: query.limit ?? 25000,
        };
    }

}
