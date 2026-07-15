import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PlacesService } from './places.service';
import { BigQueryService } from '../bigquery/bigquery.service';
import { GetPlacesDto } from './dto/requests/get-places.dto';
import { PlaceResponseDto, toPlaceDto } from './dto/responses/place-response.dto';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../cache/cache.service';
import { buildCacheKey, CACHE_TTL_SECONDS } from '../cache/cache-key.util';
import { BrandsEnrichmentService } from './brands-enrichment.service';

// Mirrors the data-affecting params the service keys on (excludes presentation params).
const placesKey = (q: GetPlacesDto) =>
  buildCacheKey('get-places', {
    lat: q.lat, lng: q.lng, radius: q.radius, country: q.country,
    min_confidence: q.min_confidence, brand_wikidata: q.brand_wikidata,
    brand_name: q.brand_name, categories: q.categories, limit: q.limit,
  });

describe('PlacesService', () => {
  let service: PlacesService;
  let bigQueryService: BigQueryService;
  let cacheService: CacheService;

  const mockBigQueryGetPlacesNearbyResponse = [
    {
      id: "08f184d6d16d5c5303f2f0fb615c6051",
      geometry: {
             coordinates: [
              -1.1516016,
              43.8711004,
            ],
         type: "Point"
       },
      bbox: {
        xmin: -1.1516017913818359,
        xmax: -1.1516015529632568,
        ymin: 43.87109375,
        ymax: 43.871101379394531,
      },
      version: "0",
      sources: [{
              property: "",
              dataset: "meta",
              record_id: "680834765441518",
              update_time: "2024-08-02T00:00:00.000Z",
              confidence: null,
            }],
      names: {
        primary: "Intermarché",
        common: null,
        rules: null,
      },
      categories: {
        primary: "supermarket",
        alternate: ["grocery_store" , "health_food_store" 
          ],
      },
      confidence: 0.54162042175360714,
      websites: ["http://www.intermarche.fr/" ],
      socials: ["https://www.facebook.com/680834765441518" ],
      
      emails: null,
      phones: ["+33558550353" ],
      brand: null,
      addresses: [{
              freeform: "rue Jean de Nasse ",
              locality: "Castets",
              postcode: "40260",
              region: null,
              country: "FR"
            }
        ]
      }
    
  ];

  const mockPlaceResponseDto = [{
        "id": "08f184d6d16d5c5303f2f0fb615c6051",
        "geometry": {
            "type": "Point",
            "coordinates": [
                -1.1516016,
                43.8711004
            ]
        },
        "bbox": {
            "xmin": -1.151601791381836,
            "xmax": -1.1516015529632568,
            "ymin": 43.87109375,
            "ymax": 43.87110137939453
        },
        "version": "0",
        "sources":  [{
              "property": "",
              "dataset": "meta",
              "record_id": "680834765441518",
              "update_time": "2024-08-02T00:00:00.000Z",
              "confidence": null
            }
          ]
        ,
        "names": {
          "primary": "Intermarché",
          "common": null,
          "rules": null
        },
        "categories": {
          "primary": "supermarket",
          "alternate": ["grocery_store","health_food_store"]
        },
        "confidence": 0.5416204217536071,
        "websites": [ "http://www.intermarche.fr/"],
        
        "socials": ["https://www.facebook.com/680834765441518"
          ],
        
        "emails": null,
        "phones": [ "+33558550353" ],
        "brand": null,
        "addresses": 
           [{
              "freeform": "rue Jean de Nasse ",
              "locality": "Castets",
              "postcode": "40260",
              "region": null,
              "country": "FR"
            
          }]
        
      }
  ];

  const mockCacheGet = jest.fn();
  const mockCacheSet = jest.fn();
  const mockBigQueryGetPlacesNearby = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlacesService,
        {
          provide: ConfigService,
          useValue: { getPlacesNearby: mockBigQueryGetPlacesNearby },
        },
        {
          provide: BigQueryService,
          useValue: { getPlacesNearby: mockBigQueryGetPlacesNearby },
        },
        {
          provide: CacheService,
          useValue: { get: mockCacheGet, set: mockCacheSet, del: jest.fn() },
        },
        {
          provide: BrandsEnrichmentService,
          useValue: { isReady: () => false, get: () => undefined },
        },
        {
          provide: Logger,
          useValue: { log: jest.fn(), error: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<PlacesService>(PlacesService);
    bigQueryService = module.get<BigQueryService>(BigQueryService);
    cacheService = module.get<CacheService>(CacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return places from cache if available', async () => {
    mockCacheGet.mockResolvedValueOnce(mockPlaceResponseDto);

    const query: GetPlacesDto = {
      lat: 43.8711004,
      lng: -1.1516016,
      radius: 1000,
      country: 'FR',
      min_confidence: 0.5,
      brand_wikidata: null,
      brand_name: 'Intermarché',
      categories: ['supermarket'],
      limit: 10,
    };

    const result = await service.getPlaces(query);

    expect(mockCacheGet).toHaveBeenCalledWith(placesKey(query));
    expect(mockBigQueryGetPlacesNearby).not.toHaveBeenCalled();
    // Pre-pagination cache entries (plain arrays) are wrapped transparently
    expect(result.results).toEqual(mockPlaceResponseDto);
    expect(result.totalCount).toBe(mockPlaceResponseDto.length);
  });

  it('should query BigQuery and cache results if cache is empty', async () => {
    mockCacheGet.mockResolvedValueOnce(null);
    const paginatedResponse = { results: mockBigQueryGetPlacesNearbyResponse, totalCount: mockBigQueryGetPlacesNearbyResponse.length };
    mockBigQueryGetPlacesNearby.mockResolvedValueOnce(paginatedResponse);
    mockCacheSet.mockResolvedValueOnce(undefined);

    const query: GetPlacesDto = {
      lat: 43.8711004,
      lng: -1.1516016,
      radius: 1000,
      country: 'FR',
      min_confidence: 0.5,
      brand_wikidata: null,
      brand_name: 'Intermarché',
      categories: ['supermarket'],
      limit: 10,
    };

    const result = await service.getPlaces(query);

    expect(mockCacheGet).toHaveBeenCalledWith(placesKey(query));
    expect(mockBigQueryGetPlacesNearby).toHaveBeenCalledWith(
      query.lat,
      query.lng,
      query.radius,
      query.brand_wikidata,
      query.brand_name,
      query.country,
      query.categories,
      query.min_confidence,
      query.limit,
      undefined, // source (applied post-query)
      undefined, // operating_status
      undefined, // taxonomy
      0,         // page
      undefined  // has_contact
    );

    expect(mockCacheSet).toHaveBeenCalledWith(placesKey(query), paginatedResponse, CACHE_TTL_SECONDS);
    expect(result.results).toEqual(mockPlaceResponseDto);
    expect(result.totalCount).toBe(1);
  });

  it('should filter places by source dataset if source is provided', async () => {
    mockCacheGet.mockResolvedValueOnce(null);
    // Add two places, only one matches the source filter
    const response = [
      {
        ...mockBigQueryGetPlacesNearbyResponse[0],
        sources: [
          { property: '', dataset: 'meta', record_id: '1', update_time: '2024-08-02T00:00:00.000Z', confidence: null },
        ],
      },
      {
        ...mockBigQueryGetPlacesNearbyResponse[0],
        id: 'other',
        sources: [
          { property: '', dataset: 'other', record_id: '2', update_time: '2024-08-02T00:00:00.000Z', confidence: null },
        ],
      },
    ];
    mockBigQueryGetPlacesNearby.mockResolvedValueOnce({ results: response, totalCount: response.length });
    mockCacheSet.mockResolvedValueOnce(undefined);

    const query: GetPlacesDto = {
      lat: 43.8711004,
      lng: -1.1516016,
      radius: 1000,
      country: 'FR',
      min_confidence: 0.5,
      brand_wikidata: null,
      brand_name: 'Intermarché',
      categories: ['supermarket'],
      limit: 10,
      source: 'meta',
    };

    const result = await service.getPlaces(query);
    expect(result.results.length).toBe(1);
    expect(result.results[0].sources[0].dataset).toBe('meta');
    // Source is a post-query filter: totalCount stays the query-wide total
    expect(result.totalCount).toBe(2);
  });

});
