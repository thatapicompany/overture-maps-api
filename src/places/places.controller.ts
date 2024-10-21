// src/places/places.controller.ts
import { Controller, Get, Logger, Query } from '@nestjs/common';
import { BigQueryService } from '../bigquery/bigquery.service';
import { GcsService } from '../gcs/gcs.service';
import { GetPlacesDto } from './dto/get-places.dto';
import { PlaceResponseDto } from './dto/place-response.dto';

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

    this.logger.debug(`Getting places near ${lat}, ${lng} within ${radius} meters`);
    // Check if cached results exist in GCS
    const cachedPlaces = await this.gcsService.getCachedPlaces(lat, lng, radius);
    if (cachedPlaces) {
      console.log('Returning cached results.');
      return cachedPlaces.map((place: any) => new PlaceResponseDto(place));
    }

    // If no cache, query BigQuery with wikidata and country support
    const places = await this.bigQueryService.getPlacesNearby(lat, lng, radius, wikidata, country);

    // Cache the results in GCS
    await this.gcsService.cachePlaces(lat, lng, radius, places);

    return places.map((place: any) => new PlaceResponseDto(place));
  }
}
