import { Test, TestingModule } from '@nestjs/testing';
import { DivisionsService } from './divisions.service';
import { ConfigService } from '@nestjs/config';
import { BigQueryService } from '../bigquery/bigquery.service';
import { CacheService } from '../cache/cache.service';
import { DivisionsSearchIndexService } from './divisions-search-index.service';
import { GetDivisionsQuery } from './dto/requests/get-divisions-query.dto';
import { plainToInstance } from 'class-transformer';

describe('DivisionsService', () => {
    let service: DivisionsService;

    const mockBigQuery = { getDivisions: jest.fn(), getDivisionById: jest.fn() };
    const mockCache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    const mockIndex = { isReady: jest.fn().mockReturnValue(false), search: jest.fn() };

    const query = (raw: any): GetDivisionsQuery => plainToInstance(GetDivisionsQuery, raw);

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DivisionsService,
                { provide: ConfigService, useValue: {} },
                { provide: BigQueryService, useValue: mockBigQuery },
                { provide: CacheService, useValue: mockCache },
                { provide: DivisionsSearchIndexService, useValue: mockIndex },
            ],
        }).compile();
        service = module.get<DivisionsService>(DivisionsService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('serves name searches from the index when it is ready', async () => {
        mockIndex.isReady.mockReturnValue(true);
        mockIndex.search.mockReturnValue({ results: [{ id: 'div-1' }], totalCount: 1 });

        const results = await service.getDivisions(query({ name: 'paris', subtype: 'locality', limit: '10' }));

        expect(results).toEqual({ results: [{ id: 'div-1' }], totalCount: 1 });
        expect(mockIndex.search).toHaveBeenCalledWith({
            name: 'paris', country: undefined, subtypes: ['locality'], bbox: undefined, limit: 10, page: 0,
        });
        expect(mockBigQuery.getDivisions).not.toHaveBeenCalled();
    });

    it('falls back to BigQuery (geometry-free) for name searches when the index is not ready', async () => {
        mockIndex.isReady.mockReturnValue(false);
        mockBigQuery.getDivisions.mockResolvedValue({ results: [], totalCount: 0 });

        await service.getDivisions(query({ name: 'paris' }));

        expect(mockBigQuery.getDivisions).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'paris', includeGeometry: false }),
        );
    });

    it('uses BigQuery with geometry for point queries even when the index is ready', async () => {
        mockIndex.isReady.mockReturnValue(true);
        mockBigQuery.getDivisions.mockResolvedValue({ results: [], totalCount: 0 });

        await service.getDivisions(query({ lat: '40.7', lng: '-74.0' }));

        expect(mockIndex.search).not.toHaveBeenCalled();
        expect(mockBigQuery.getDivisions).toHaveBeenCalledWith(
            expect.objectContaining({ latitude: 40.7, longitude: -74, includeGeometry: true }),
        );
    });

    it('honours an explicit include_geometry=true on a name search (BigQuery path)', async () => {
        mockIndex.isReady.mockReturnValue(true);
        mockBigQuery.getDivisions.mockResolvedValue({ results: [], totalCount: 0 });

        await service.getDivisions(query({ name: 'paris', include_geometry: 'true' }));

        expect(mockIndex.search).not.toHaveBeenCalled();
        expect(mockBigQuery.getDivisions).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'paris', includeGeometry: true }),
        );
    });
});
