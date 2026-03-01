/*
https://docs.nestjs.com/controllers#controllers
*/

import { Controller, Logger, Query, Get } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { GetBuildingsQuery } from './dto/requests/get-buildings-query.dto';
import { BuildingDto, toBuildingDto } from './dto/responses/building-response.dto';
import { wrapAsGeoJSON } from '../utils/geojson';
import { Format } from '../common/dto/requests/get-by-location.dto';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { IsAuthenticatedGuard } from '../guards/is-authenticated.guard';

@ApiTags('Buildings')
@ApiSecurity('API_KEY') // Applies the API key security scheme defined in Swagger
@Controller('buildings')
@UseGuards(IsAuthenticatedGuard)
export class BuildingsController {

  logger = new Logger('BuildingsController');

  constructor(
    private readonly buildingsService: BuildingsService,
  ) { }

  @Get()
  async getBuildings(@Query() query: GetBuildingsQuery): Promise<BuildingDto[] | any> {


    const buildings = await this.buildingsService.getBuildings(query);

    const dtoResults = buildings.map((building: any) => toBuildingDto(building, query));

    if (query.format === Format.GEOJSON) {
      return wrapAsGeoJSON(dtoResults)
    } else {
      return dtoResults
    }
  }

}
