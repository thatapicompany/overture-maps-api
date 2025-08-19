
import { Controller, Get, HttpException, Logger, Query, UseGuards } from '@nestjs/common';
import { BigQueryService } from '../bigquery/bigquery.service';
import { GcsService } from '../gcs/gcs.service';
import { GetPlacesDto } from './dto/requests/get-places.dto';
import { PlaceResponseDto, toPlaceDto, toPlaceWithBuildingDto } from './dto/responses/place-response.dto';
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
import { CountHeader } from '../decorators/count-header.decorator';
import { loadEnrichmentAdapter } from '../data-adapters/loadEnrichmentAdapter';
import { EnrichmentAdapter } from '../data-adapters/EnrichmentAdapter';

@ApiTags('Places')
@ApiSecurity('API_KEY') // Applies the API key security scheme defined in Swagger
@Controller('places')
@UseGuards(IsAuthenticatedGuard)
export class PlacesController {

  logger = new Logger('PlacesController');
  
  constructor(
    private placesService: PlacesService,
    private buildingsService: BuildingsService

  ) {}

  private enrichmentAdapter: EnrichmentAdapter = loadEnrichmentAdapter();

  @Get()
  @ApiOperation({ summary: 'Get Places using Query params as filters' })
  @ApiQuery({type:GetPlacesDto})
  @ApiResponse({ status: 200, description: 'Return Places.' , type: PlaceResponseDto, isArray: true})
  @CountHeader() 
  @ValidateLatLngUser()
  async getPlaces(@Query() query: GetPlacesDto, @AuthedUser() user: User) {

    
      // If no cache, query BigQuery with wikidata and country support
    const  results = await this.placesService.getPlaces(query);
    const dtoResults = results.map((place: any) =>toPlaceDto(place,query));

    let finalResults = dtoResults;
    try {
      const fields = query.enrichment_fields;
      if (fields && fields.length) {
        const ids = dtoResults.map((p) => p.id);
        const enrichment = await this.enrichmentAdapter.fetchEnrichmentByIds(ids, { fields });
        finalResults = dtoResults.map((p) => {
          const data = enrichment[p.id];
          if (!data || Object.keys(data).length === 0) return p;
          return { ...p, enrichment: { source: 'hosted', fields: data } };
        });
      }
    } catch (err: any) {
      this.logger.warn(`Enrichment failed: ${err.message}`);
    }

    if(query.format ===  Format.GEOJSON) {
      return wrapAsGeoJSON  (finalResults)
    }
    return finalResults
  }

  @Get('buildings')
  @ApiOperation({ summary: 'Get Places with their Building shapes using Query params as filters' })
  @ApiQuery({type:GetPlacesWithBuildingsDto})
  @ApiResponse({ status: 200, description: 'Return Places with Buildings.' , type: PlaceResponseDto, isArray: true})
  @CountHeader() 
  @ValidateLatLngUser()
  async getPlacesWithBuildings(@Query() query: GetPlacesWithBuildingsDto, @AuthedUser() user: User) {

    if(query.match_nearest_building!==true) {
      throw new HttpException("match_nearest_building must be true in the Demo API to get building shapes due to cost reasons", 400);
      //ToDo: refactor query to be optimised for this use case as is currently $2.25 per query instead of $0.02
    }


    // test if query.match_nearest_building is true
    this.logger.log(`Query: ${JSON.stringify(query)} ${query.match_nearest_building===true}`);
    
    const placesWithBuildings = await this.placesService.getPlacesWithNearestBuilding(query);
  
    // Map results to DTOs and wrap in GeoJSON if requested
    const dtoResults = placesWithBuildings.map((place) => toPlaceWithBuildingDto(place, query));
    return query.format === Format.GEOJSON ? wrapAsGeoJSON(dtoResults) : dtoResults;
  }
  
  
    
    @Get('brands')
    @ApiOperation({ summary: 'Get all Brands from Places using Query params as filters' })
    @ApiResponse({ status: 200, description: 'Return all Brands, along with a count of all Places for each.' , type: BrandDto, isArray: true})
    @ApiQuery({type:GetBrandsDto})
    @CountHeader() 
    @ValidateLatLngUser()
    async getBrands(@Query() query: GetBrandsDto, @AuthedUser() user: User) {

      return await this.placesService.getBrands(query);

    }

    @Get('countries')
    @ApiOperation({ summary: 'Get all Countries from Places using Query params as filters' })
    @ApiResponse({ status: 200, description: 'Return all Countries, as well as a count of all the Places and Brands in each.', type:CountryResponseDto, isArray: true})
    @CountHeader() 
    @ValidateLatLngUser()
    async getCountries() {

        return await this.placesService.getCountries();
        
    }

    @Get('categories')
    @ApiOperation({ summary: 'Get all Categories from Places using Query params as filters' })
    @ApiResponse({ status: 200, description: 'Return all Categories, along with a count of all Brands and Places for each' , type: CategoryResponseDto, isArray: true})
    @ApiQuery({type:GetCategoriesDto})
    @CountHeader() 
    @ValidateLatLngUser()
    async getCategories(@Query() query: GetCategoriesDto, @AuthedUser() user: User):Promise<CategoryResponseDto[]> {

        return await this.placesService.getCategories(query);
        
    }

}
