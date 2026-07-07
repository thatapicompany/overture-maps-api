/*
https://docs.nestjs.com/providers#services
*/

import { Injectable, Logger } from '@nestjs/common';
import { BigQueryService } from '../bigquery/bigquery.service';
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
import { CacheService } from '../cache/cache.service';
import { buildCacheKey, CACHE_TTL_SECONDS } from '../cache/cache-key.util';
import { GetPlacesWithBuildingsDto } from './dto/requests/get-places-with-buildings';

@Injectable()
export class PlacesService {
    logger = new Logger('PlacesService');
    
    constructor(
        private readonly configService: ConfigService,
        private readonly bigQueryService: BigQueryService,
        private readonly cacheService: CacheService,
    ) {}
    async getPlaces(query: GetPlacesDto): Promise<{ results: Place[], totalCount: number }> {
        const { lat, lng, radius, country, min_confidence, brand_wikidata, brand_name, categories, limit, source, page = 0 } = query;
        const cacheKey = buildCacheKey('get-places', { lat, lng, radius, country, min_confidence, brand_wikidata, brand_name, categories, limit, source, page });
        let cached = await this.cacheService.get<{ results: Place[], totalCount: number }>(cacheKey);
        if (!cached) {
          cached = await this.bigQueryService.getPlacesNearby(lat, lng, radius, brand_wikidata, brand_name, country, categories, min_confidence, limit, source, page);
          await this.cacheService.set(cacheKey, cached, CACHE_TTL_SECONDS);
        }
        return cached;
      }

      async getPlacesWithNearestBuilding(query: GetPlacesWithBuildingsDto): Promise<{ results: PlaceWithBuilding[], totalCount: number }> {
        const { lat, lng, radius, country, min_confidence, brand_wikidata, brand_name, categories, limit, match_nearest_building, page = 0 } = query;
        const cacheKey = buildCacheKey('get-places-with-building', { lat, lng, radius, country, min_confidence, brand_wikidata, brand_name, categories, limit, match_nearest_building, page });
        let cached = await this.cacheService.get<{ results: PlaceWithBuilding[], totalCount: number }>(cacheKey);
        if (!cached) {
          cached = await this.bigQueryService.getPlacesWithNearestBuilding(lat, lng, radius, brand_wikidata, brand_name, country, categories, min_confidence, limit, match_nearest_building, page);
          await this.cacheService.set(cacheKey, cached, CACHE_TTL_SECONDS);
        }
        return cached;
      }

    async getBrands(query: GetBrandsDto): Promise<BrandDto[]> {
        const { country, lat, lng, radius, categories } = query;

        const cacheKey = buildCacheKey('get-places-brands', { country, lat, lng, radius, categories });
        const cachedResult = await this.cacheService.get<any[]>(cacheKey);
        if (cachedResult) {
          return cachedResult.map((brand: any) => new BrandDto(brand));
        }

        const results = await this.bigQueryService.getBrandsNearby(country, lat, lng, radius, categories);
        await this.cacheService.set(cacheKey, results, CACHE_TTL_SECONDS);
        return results.map((brand: any) => new BrandDto(brand));
      }

    async getCountries():Promise<CountryResponseDto[]> {
        const cacheKey = `get-places-countries`;
        const cachedResult = await this.cacheService.get<any[]>(cacheKey);
        if (cachedResult) {
          return cachedResult.map((country: any) => toCountryResponseDto(country));
        }

        const results = await this.bigQueryService.getPlaceCountsByCountry();
        await this.cacheService.set(cacheKey, results, CACHE_TTL_SECONDS);
        return results.map((country: any) => toCountryResponseDto(country));
    }

    async getCategories(query: GetCategoriesDto): Promise<CategoryResponseDto[]> {

        const cacheKey = buildCacheKey('get-places-categories', { country: query.country, lat: query.lat, lng: query.lng, radius: query.radius });
        const cachedResult = await this.cacheService.get<any[]>(cacheKey);
        if (cachedResult) {
          return cachedResult.map((category: any) => toCategoryResponseDto(category));
        }

        const results = await this.bigQueryService.getCategories(query.country, query.lat, query.lng, query.radius);

        await this.cacheService.set(cacheKey, results, CACHE_TTL_SECONDS);
        return results.map((category: any) => toCategoryResponseDto(category));
      }

}
