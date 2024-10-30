// src/places/places.controller.ts
import { Controller, Get, Logger, Query, UseGuards } from '@nestjs/common';
import { BigQueryService } from '../bigquery/bigquery.service';
import { GcsService } from '../gcs/gcs.service';
import { GetPlacesDto } from './dto/get-places.dto';
import { PlaceResponseDto } from './dto/place-response.dto';
import { GetBrandsDto } from './dto/get-brands.dto';
import { IsAuthenticatedGuard } from '../guards/is-authenticated.guard';

@Controller('places')
@UseGuards(IsAuthenticatedGuard)
export class PlacesController {

  logger = new Logger('PlacesController');
  
  constructor(
    private readonly bigQueryService: BigQueryService,
    private readonly gcsService: GcsService,
  ) {}

  @Get()
  async getPlaces(@Query() query: GetPlacesDto) {

    const { lat, lng, radius,  country, min_confidence, brand_wikidata,brand_name,categories,limit } = query;

    const cacheKey = `get-places-${JSON.stringify(query)}`;

    // Check if cached results exist in GCS
    const cachedResult = await this.gcsService.getJSON(cacheKey);
    if (cachedResult) {
      return cachedResult.map((place: any) => new PlaceResponseDto(place));
    }

    // if only country is provided, then potentially just use the lat / lng of it's capital city

    // If no cache, query BigQuery with wikidata and country support
    const places = await this.bigQueryService.getPlacesNearby(lat, lng, radius, brand_wikidata,brand_name, country, categories, min_confidence,limit);

    // Cache the results in GCS
    //await this.gcsService.storeJSON (places,cacheKey);

    return places.map((place: any) => new PlaceResponseDto(place));
  }
    
  @Get('brands')
    async getBrands(@Query() query: GetBrandsDto) {
      const { country, lat, lng, radius, categories } = query;
  
      const cacheKey = `get-places-brands-${JSON.stringify(query)}`;

    // Check if cached results exist in GCS
    const cachedResult = await this.gcsService.getJSON(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }
    
      const brands = await this.bigQueryService.getBrandsNearby(country, lat, lng, radius, categories);
      
      return brands;
    }
    @Get('countries')
    async getCountries() {
        const cacheKey = `get-places-countries`;
        const cachedResult = await this.gcsService.getJSON(cacheKey);
        if (cachedResult) {
          return cachedResult;
        }

        const brands = await this.bigQueryService.getPlaceCountsByCountry();
      
        return brands;
    }
}
