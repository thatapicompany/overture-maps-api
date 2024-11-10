
import { Controller, Get, Logger, Query, UseGuards } from '@nestjs/common';
import { BigQueryService } from '../bigquery/bigquery.service';
import { GcsService } from '../gcs/gcs.service';
import { GetPlacesDto } from './dto/requests/get-places.dto';
import { PlaceResponseDto, toPlaceDto } from './dto/responses/place-response.dto';
import { GetBrandsDto } from './dto/requests/get-brands.dto';
import { IsAuthenticatedGuard } from '../guards/is-authenticated.guard';
import { GetCategoriesDto } from './dto/requests/get-categories.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody , ApiQuery, ApiSecurity} from '@nestjs/swagger';
import { BrandDto } from './dto/models/brand.dto';
import { CountryResponseDto, toCountryResponseDto } from './dto/responses/country-response.dto';
import { CategoryResponseDto, toCategoryResponseDto } from './dto/responses/category-response.dto';
import { AuthedUser, User } from '../decorators/authed-user.decorator';
import { ValidateLatLngUser } from '../decorators/validate-lat-lng-user.decorator';
import { PlacesService } from './places.service';
import { findNearestPolygon, isPointInPolygon, isPointInPolygonWithoutTurf, wrapAsGeoJSON } from '../utils/geojson';
import { Format } from '../common/dto/requests/get-by-location.dto';
import { BuildingsService } from '../buildings/buildings.service';
import { Feature, GeoJsonObject, Geometry } from 'geojson';
import { GetPlacesWithBuildingsDto } from './dto/requests/get-places-with-buildings';

@ApiTags('places')
@ApiSecurity('API_KEY') // Applies the API key security scheme defined in Swagger
@Controller('places')
@UseGuards(IsAuthenticatedGuard)
export class PlacesController {

  logger = new Logger('PlacesController');
  
  constructor(
    private placesService: PlacesService,
    private buildingsService: BuildingsService

  ) {}

  @Get()
  @ValidateLatLngUser()
  @ApiOperation({ summary: 'Get Places using Query params as filters' })
  @ApiQuery({type:GetPlacesDto})
  @ApiResponse({ status: 200, description: 'Return Places.' , type: PlaceResponseDto, isArray: true})
  async getPlaces(@Query() query: GetPlacesDto, @AuthedUser() user: User) {

    
      // If no cache, query BigQuery with wikidata and country support
    const  results = await this.placesService.getPlaces(query);
    const dtoResults = results.map((place: any) =>toPlaceDto(place,query));

    if(query.format ===  Format.GEOJSON) {
      return wrapAsGeoJSON  (dtoResults)
    }
    return dtoResults
  }

  @Get('buildings')
  //@ValidateLatLngUser()
  @ApiOperation({ summary: 'Get Places with their Building shapes using Query params as filters' })
  @ApiQuery({type:GetPlacesWithBuildingsDto})
  @ApiResponse({ status: 200, description: 'Return Places with Buildings.' , type: PlaceResponseDto, isArray: true})
  async getPlacesWithBuildings(@Query() query: GetPlacesWithBuildingsDto, @AuthedUser() user: User) {

    if(query.radius>5000) {
      throw new Error("Radius is too large, please use a radius less than 5000 meters")
      //ToDo: implement building matching via SQL for larger radius queries
    }

    // Execute getPlaces and getBuildings concurrently
    const [places, buildings] = await Promise.all([
      this.placesService.getPlaces(query),
      //limit should be higher than the number of places as needs more to choose from as places are higher density
      this.buildingsService.getBuildings({...query,limit:10000}),
    ]);
  
    // Extract building geometries for quick reference and log a specific building if needed
    const buildingGeoms = buildings.map((building) => building.geometry);
    this.logger.log(`Building geometries extracted. Looking for specific ID if applicable.`);
  
    // Find the building containing each place or the nearest neighbor if no match is found
    let numMatches = 0;
    const results = places.map((place) => {
      if (!place.geometry) {
        return place;
      }

      if(place.geometry.type!="Point") {
        return place;
      }
      
      const matchingBuilding = buildings.find((building) => isPointInPolygon(place.geometry, building.geometry));
  
      if (matchingBuilding) {
        place.geometry = matchingBuilding.geometry;
        numMatches++;
      } else if (query.match_nearest_building) {

        // If no exact match is found, try to find the nearest building geometry
        const nearestGeometry = findNearestPolygon(place.geometry, buildingGeoms, 100);
        if (nearestGeometry) {
          place.geometry = nearestGeometry;
          numMatches++;
        }
      }
  
      return place;
    });
  
    this.logger.log(`Found ${numMatches} matches`);
  
    // Map results to DTOs and wrap in GeoJSON if requested
    const dtoResults = results.map((place) => toPlaceDto(place, query));
    return query.format === Format.GEOJSON ? wrapAsGeoJSON(dtoResults) : dtoResults;
  }
  
  
    
  @Get('brands')
  @ValidateLatLngUser()
  @ApiOperation({ summary: 'Get all Brands from Places using Query params as filters' })
  @ApiResponse({ status: 200, description: 'Return all Brands, along with a count of all Places for each.' , type: BrandDto, isArray: true})
  @ApiQuery({type:GetBrandsDto})
    async getBrands(@Query() query: GetBrandsDto, @AuthedUser() user: User) {

      return await this.placesService.getBrands(query);

    }

    @Get('countries')
    @ValidateLatLngUser()
    @ApiOperation({ summary: 'Get all Countries from Places using Query params as filters' })
    @ApiResponse({ status: 200, description: 'Return all Countries, as well as a count of all the Places and Brands in each.', type:CountryResponseDto, isArray: true})
    async getCountries() {

        return await this.placesService.getCountries();
        
    }

    @Get('categories')
    @ValidateLatLngUser()
    @ApiOperation({ summary: 'Get all Categories from Places using Query params as filters' })
    @ApiResponse({ status: 200, description: 'Return all Categories, along with a count of all Brands and Places for each' , type: CategoryResponseDto, isArray: true})
    @ApiQuery({type:GetCategoriesDto})
    async getCategories(@Query() query: GetCategoriesDto):Promise<CategoryResponseDto[]> {

        return await this.placesService.getCategories(query);
        
    }

}
