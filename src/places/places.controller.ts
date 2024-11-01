// src/places/places.controller.ts
import { Controller, Get, Logger, Query, UseGuards } from '@nestjs/common';
import { BigQueryService } from '../bigquery/bigquery.service';
import { GcsService } from '../gcs/gcs.service';
import { GetPlacesDto } from './dto/requests/get-places.dto';
import { PlaceResponseDto, toPlacesGeoJSONResponseDto } from './dto/place-response.dto';
import { GetBrandsDto } from './dto/requests/get-brands.dto';
import { IsAuthenticatedGuard } from '../guards/is-authenticated.guard';
import { GetCategoriesDto } from './dto/requests/get-categories.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody , ApiQuery, ApiSecurity} from '@nestjs/swagger';
import { BrandDto } from './dto/models/brand.dto';
import { CountryResponseDto, toCountryResponseDto } from './dto/responses/country-response.dto';
import { CategoryResponseDto, toCategoryResponseDto } from './dto/responses/category-response.dto';

@ApiTags('places')
@ApiSecurity('API_KEY') // Applies the API key security scheme defined in Swagger
@Controller('places')
@UseGuards(IsAuthenticatedGuard)
export class PlacesController {

  logger = new Logger('PlacesController');
  
  constructor(
    private readonly bigQueryService: BigQueryService,
    private readonly gcsService: GcsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all Places using Query params as filters' })
  @ApiResponse({ status: 200, description: 'Return all Places.' , type: PlaceResponseDto, isArray: true})
  @ApiQuery({type:GetPlacesDto})
  async getPlaces(@Query() query: GetPlacesDto) {

    const { lat, lng, radius,  country, min_confidence, brand_wikidata,brand_name,categories,limit } = query;

    const cacheKey = `get-places-${JSON.stringify(query)}`;

    // Check if cached results exist in GCS
      let results = await this.getFromCache(cacheKey);
    if (!results) {
      // if only country is provided, then potentially just use the lat / lng of it's capital city
  
      // If no cache, query BigQuery with wikidata and country support
      results = await this.bigQueryService.getPlacesNearby(lat, lng, radius, brand_wikidata,brand_name, country, categories, min_confidence,limit);
  
      // Cache the results in GCS
      await this.gcsService.storeJSON (results,cacheKey);

      return results.map((place: any) => new PlaceResponseDto(place));
    }


    if(query.format === 'geojson') {
      return toPlacesGeoJSONResponseDto(results);
    }
    return results.map((place: any) => new PlaceResponseDto(place));
  }
    
  @Get('brands')
  @ApiOperation({ summary: 'Get all Brands from Places using Query params as filters' })
  @ApiResponse({ status: 200, description: 'Return all Brands, along with a count of all Places for each.' , type: BrandDto, isArray: true})
  @ApiQuery({type:GetBrandsDto})
    async getBrands(@Query() query: GetBrandsDto) {
      const { country, lat, lng, radius, categories } = query;

      // Check if cached results exist in GCS
      const cacheKey = `get-places-brands-${JSON.stringify(query)}`;
      const cachedResult = await this.getFromCache(cacheKey);
      if (cachedResult) {
        return cachedResult;
      }
    
      const results = await this.bigQueryService.getBrandsNearby(country, lat, lng, radius, categories);
      await this.gcsService.storeJSON (results,cacheKey);
      return results.map((brand: any) => new BrandDto(brand));
    }
    @Get('countries')
    @ApiOperation({ summary: 'Get all Countries from Places using Query params as filters' })
    @ApiResponse({ status: 200, description: 'Return all Countries, as well as a count of all the Places and Brands in each.', type:CountryResponseDto, isArray: true})
    async getCountries() {
        const cacheKey = `get-places-countries`;
        const cachedResult = await this.getFromCache(cacheKey);
        if (cachedResult) {
          return cachedResult;
        }

        const results = await this.bigQueryService.getPlaceCountsByCountry();
        await this.gcsService.storeJSON (results,cacheKey);
        return results.map((country: any) => toCountryResponseDto(country));
    }

    @Get('categories')
    @ApiOperation({ summary: 'Get all Categories from Places using Query params as filters' })
    @ApiResponse({ status: 200, description: 'Return all Categories, along with a count of all Brands and Places for each' , type: CategoryResponseDto, isArray: true})
    @ApiQuery({type:GetCategoriesDto})
    async getCategories(@Query() query: GetCategoriesDto) {

      const cacheKey = `get-places-categories-${JSON.stringify(query)}`;
        const cachedResult = await this.getFromCache(cacheKey );
        if (cachedResult) {
          return cachedResult;
        }
        
        const results = await this.bigQueryService.getCategories(query.country);
        
        await this.storeToCache (results, cacheKey);
        return results.map((category: any) => toCategoryResponseDto(category));
    }

    async getFromCache(cacheKey:string): Promise<any[]|null> {
        try{;
          const cachedResult = await this.gcsService.getJSON(cacheKey);
          this.logger.log(`Cache hit for get-places-categories-${JSON.stringify(cacheKey)} - cachedResult length: ${cachedResult.length}`);
          return cachedResult;
        }catch(error){
          this.logger.error('Error fetching cached places:', error);
          return null;
        }
    }

    async storeToCache( data,cacheKey:string): Promise<void> {
      try{

        await this.gcsService.storeJSON (data,cacheKey);
      }catch(error){
        this.logger.error('Error saving cached places:', error);
      }
    }
}
