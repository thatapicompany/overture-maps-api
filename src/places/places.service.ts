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
import { BrandsEnrichmentService } from './brands-enrichment.service';

@Injectable()
export class PlacesService {
    logger = new Logger('PlacesService');

    constructor(
        private readonly configService: ConfigService,
        private readonly bigQueryService: BigQueryService,
        private readonly cacheService: CacheService,
        private readonly brandsEnrichment: BrandsEnrichmentService,
    ) {}

    /**
     * Decorates a BrandDto with Wikidata-sourced ext_ fields when the
     * enrichment artifact is loaded. Applied after the cache layer so
     * enrichment availability never splits or invalidates cached results.
     */
    private toBrandDtoWithEnrichment(brand: any): BrandDto {
        const dto = new BrandDto(brand);
        const enrichment = this.brandsEnrichment.get(brand?.wikidata);
        if (enrichment) {
            dto.ext_logo_url = enrichment.logo_url;
            dto.ext_website = enrichment.website;
            dto.ext_industry = enrichment.industry;
            dto.ext_parent = enrichment.parent;
            dto.ext_wikidata_label = enrichment.label;
        }
        return dto;
    }
    async getPlaces(query: GetPlacesDto):Promise<{ results: Place[]; totalCount: number }> {

        const { lat, lng, radius,  country, min_confidence, brand_wikidata,brand_name,categories,limit, page = 0, source, operating_status, taxonomy } = query;
        // Key on data-affecting params only. `source` is applied as a post-query
        // filter below, so it must not split the cache. Page 0 keeps the
        // pre-pagination key so warm cache entries stay useful.
        const cacheKey = buildCacheKey('get-places', { lat, lng, radius, country, min_confidence, brand_wikidata, brand_name, categories, limit, operating_status, taxonomy, page: page > 0 ? page : undefined });
        let cached = await this.cacheService.get<any>(cacheKey);
        // Entries cached before pagination shipped are plain arrays; wrap them
        // so they stay valid until their TTL expires.
        if (Array.isArray(cached)) {
          cached = { results: cached, totalCount: cached.length };
        }
        if (!cached?.results) {
          cached = await this.bigQueryService.getPlacesNearby(lat, lng, radius, brand_wikidata, brand_name, country, categories, min_confidence, limit, undefined, operating_status, taxonomy, page);
          await this.cacheService.set(cacheKey, cached, CACHE_TTL_SECONDS);
        }
        // Filter by source if provided (post-query filter: totalCount stays the
        // query-wide total, the source filter narrows the returned page only)
        let results: Place[] = cached.results;
        if (source) {
          results = results.filter(place => Array.isArray(place.sources) && place.sources.some(s => s.dataset === source));
        }
        return { results, totalCount: cached.totalCount };
      }

    
      async getPlacesWithNearestBuilding(query: GetPlacesWithBuildingsDto):Promise<{ results: PlaceWithBuilding[]; totalCount: number }> {

        const { lat, lng, radius, country, min_confidence, brand_wikidata,brand_name,categories,limit, page = 0, match_nearest_building, operating_status, taxonomy} = query;

        const cacheKey = buildCacheKey('get-places-with-building', { lat, lng, radius, country, min_confidence, brand_wikidata, brand_name, categories, limit, match_nearest_building, operating_status, taxonomy, page: page > 0 ? page : undefined });
        let cached = await this.cacheService.get<any>(cacheKey);
        if (Array.isArray(cached)) {
          cached = { results: cached, totalCount: cached.length };
        }
        if (!cached?.results) {
          cached = await this.bigQueryService.getPlacesWithNearestBuilding(lat, lng, radius, brand_wikidata, brand_name, country, categories, min_confidence, limit, match_nearest_building, operating_status, taxonomy, page);
          await this.cacheService.set(cacheKey, cached, CACHE_TTL_SECONDS);
        }
        return cached;

      }

    async getBrands(query: GetBrandsDto): Promise<BrandDto[]> {
        const { country, lat, lng, radius, categories } = query;

        const cacheKey = buildCacheKey('get-places-brands', { country, lat, lng, radius, categories });
        const cachedResult = await this.cacheService.get<any[]>(cacheKey);
        if (cachedResult) {
          return cachedResult.map((brand: any) => this.toBrandDtoWithEnrichment(brand));
        }

        const results = await this.bigQueryService.getBrandsNearby(country, lat, lng, radius, categories);
        await this.cacheService.set(cacheKey, results, CACHE_TTL_SECONDS);
        return results.map((brand: any) => this.toBrandDtoWithEnrichment(brand));
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
