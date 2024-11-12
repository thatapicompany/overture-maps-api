/*
https://docs.nestjs.com/providers#services
*/

import { Injectable, Logger } from '@nestjs/common';
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
import { Place, PlaceWithBuilding } from './interfaces/place.interface';
import { ConfigService } from '@nestjs/config';
import { CloudStorageCacheService } from '../cloudstorage-cache/cloudstorage-cache.service';
import { GetPlacesWithBuildingsDto } from './dto/requests/get-places-with-buildings';

@Injectable()
export class PlacesService {
    logger = new Logger('PlacesService');
    
    constructor(
        private readonly configService: ConfigService,
      private readonly bigQueryService: BigQueryService,
      private readonly cloudStorageCache: CloudStorageCacheService,
    ) {}
    async getPlaces(query: GetPlacesDto):Promise<Place[]> {

        const { lat, lng, radius,  country, min_confidence, brand_wikidata,brand_name,categories,limit } = query;
    
        const cacheKey = `get-places-${JSON.stringify(query)}`;
    
        // Check if cached results exist in GCS
        let results:Place[] = await this.cloudStorageCache.getJSON(cacheKey);
        if (!results) {
          // If no cache, query BigQuery with wikidata and country support
          results = await this.bigQueryService.getPlacesNearby(lat, lng, radius, brand_wikidata,brand_name, country, categories, min_confidence,limit);
          // Cache the results in GCS
          await this.cloudStorageCache.storeJSON (results,cacheKey);
    
        }
          return results
        
      }

    
      async getPlacesWithNearestBuilding(query: GetPlacesWithBuildingsDto):Promise<PlaceWithBuilding[]> {

        const { lat, lng, radius, country, min_confidence, brand_wikidata,brand_name,categories,limit, match_nearest_building} = query;
    
        const cacheKey = `get-places-${JSON.stringify(query)}`;
    
        // Check if cached results exist in GCS
        let results:PlaceWithBuilding[] = await this.cloudStorageCache.getJSON(cacheKey);
        if (!results) {
          // If no cache, query BigQuery with wikidata and country support
          results = await this.bigQueryService.getPlacesWithNearestBuilding(lat, lng, radius,  brand_wikidata,brand_name, country, categories, min_confidence,limit, match_nearest_building );
          // Cache the results in GCS
          await this.cloudStorageCache.storeJSON (results,cacheKey);
    
        }
          return results
        
      }

    async getBrands(query: GetBrandsDto): Promise<BrandDto[]> {
        const { country, lat, lng, radius, categories } = query;
  
        // Check if cached results exist in GCS
        const cacheKey = `get-places-brands-${JSON.stringify(query)}`;
        const cachedResult = await this.cloudStorageCache.getJSON(cacheKey);
        if (cachedResult) {
          return cachedResult;
        }
      
        const results = await this.bigQueryService.getBrandsNearby(country, lat, lng, radius, categories);
        await this.cloudStorageCache.storeJSON (results,cacheKey);
        return results.map((brand: any) => new BrandDto(brand));
      }

    async getCountries():Promise<CountryResponseDto[]> {
        const cacheKey = `get-places-countries`;
        const cachedResult = await this.cloudStorageCache.getJSON(cacheKey);
        if (cachedResult) {
          return cachedResult;
        }

        const results = await this.bigQueryService.getPlaceCountsByCountry();
        await this.cloudStorageCache.storeJSON (results,cacheKey);
        return results.map((country: any) => toCountryResponseDto(country));
    }

    async getCategories(query: GetCategoriesDto): Promise<CategoryResponseDto[]> {

        const cacheKey = `get-places-categories-${JSON.stringify(query)}`;
          const cachedResult = await this.cloudStorageCache.getJSON(cacheKey );
          if (cachedResult) {
            return cachedResult;
          }
          
          const results = await this.bigQueryService.getCategories(query.country, query.lat, query.lng, query.radius);
          
          await this.cloudStorageCache.storeJSON (results, cacheKey);
            return results.map((category: any) => toCategoryResponseDto(category));
      }

}
