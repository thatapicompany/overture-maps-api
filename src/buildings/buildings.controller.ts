/*
https://docs.nestjs.com/controllers#controllers
*/

import { Controller, Logger, Query, Get } from '@nestjs/common';
import { requirePoint } from '../common/require-point';
import { BuildingsService } from './buildings.service';
import { GetBuildingsQuery } from './dto/requests/get-buildings-query.dto';
import { BuildingDto, toBuildingDto } from './dto/responses/building-response.dto';
import { wrapAsGeoJSON } from '../utils/geojson';
import { Format } from '../common/dto/requests/get-by-location.dto';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiStandardErrors, PAGINATION_HEADERS } from '../openapi/openapi.decorators';
import { UseGuards } from '@nestjs/common';
import { IsAuthenticatedGuard } from '../guards/is-authenticated.guard';
import { DemoLocationGuard } from '../guards/demo-location.guard';
import { CountHeader } from '../decorators/count-header.decorator';

@ApiTags('Buildings')
@ApiSecurity('API_KEY') // Applies the API key security scheme defined in Swagger
@ApiStandardErrors()
@Controller('buildings')
@UseGuards(IsAuthenticatedGuard, DemoLocationGuard)
export class BuildingsController {

  logger = new Logger('BuildingsController');

  constructor(
    private readonly buildingsService: BuildingsService,
  ) { }

  @Get()
  @ApiOperation({
    operationId: "searchBuildings",
    summary: "Search building footprints",
    description: "Find buildings within `radius` metres of a `lat`/`lng`, with footprint geometry and attributes such as height and number of floors where known. A location is required. Use `format=geojson` to draw them on a map.",
  })
  @ApiResponse({ status: 200, description: 'Buildings near the point.', type: BuildingDto, isArray: true, headers: PAGINATION_HEADERS })
  @CountHeader()
  async getBuildings(@Query() query: GetBuildingsQuery): Promise<BuildingDto[] | any> {
    requirePoint(query, '/buildings');


    const { results, totalCount } = await this.buildingsService.getBuildings(query);

    const dtoResults = results.map((building: any) => toBuildingDto(building, query));

    // The PaginationInterceptor unwraps this envelope: clients receive the
    // same array/GeoJSON body as always, with Pagination-* headers added.
    return { results: dtoResults, totalCount, page: query.page ?? 0, limit: query.limit };
  }

}
