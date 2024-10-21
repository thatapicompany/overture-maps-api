// src/places/places.controller.ts
import { Controller, Get, Logger, Query } from '@nestjs/common';
import { BigQueryService } from '../bigquery/bigquery.service';
import { GcsService } from '../gcs/gcs.service';
import { GetPlacesDto } from './dto/get-places.dto';
import { PlaceResponseDto } from './dto/place-response.dto';
import { GetBrandsDto } from './dto/get-brands.dto';

@Controller('places')
export class PlacesController {

    logger = new Logger('PlacesController');
  constructor(
    private readonly bigQueryService: BigQueryService,
    private readonly gcsService: GcsService,
  ) {}

  @Get()
  async getPlaces(@Query() query: GetPlacesDto) {
    const { lat, lng, radius, wikidata, country } = query;

    const cacheKey = `get-places-${JSON.stringify(query)}`;

    // Check if cached results exist in GCS
    const cachedResult = await this.gcsService.getJSON(cacheKey);
    if (cachedResult) {
      return cachedResult.map((place: any) => new PlaceResponseDto(place));
    }

    // If no cache, query BigQuery with wikidata and country support
    const places = await this.bigQueryService.getPlacesNearby(lat, lng, radius, wikidata, country);

    // Cache the results in GCS
    await this.gcsService.storeJSON (places,cacheKey);

    return places.map((place: any) => new PlaceResponseDto(place));
  }
    @Get('brands')
    async getBrands(@Query() query: GetBrandsDto) {
      const { country_code, lat, lng, radius } = query;
  
      const cacheKey = `get-places-brands-${JSON.stringify(query)}`;

    // Check if cached results exist in GCS
    const cachedResult = await this.gcsService.getJSON(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }
    
      const brands = await this.bigQueryService.getBrandsNearby(country_code, lat, lng, radius);
      
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
