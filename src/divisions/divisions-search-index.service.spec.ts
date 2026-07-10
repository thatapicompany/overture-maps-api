import { gzipSync } from 'zlib';
import { DivisionsSearchIndexService, DIVISIONS_SEARCH_INDEX_OBJECT } from './divisions-search-index.service';
import { GcsService } from '../gcs/gcs.service';

const FIXTURE_ROWS = [
    { id: 'div-westminster', primary: 'City of Westminster', en: 'Westminster', country: 'GB', region: 'GB-WSM', subtype: 'county', class: 'county', bbox: [-0.22, 51.48, -0.11, 51.54] },
    { id: 'div-westminster-co', primary: 'Westminster', country: 'US', region: 'US-CO', subtype: 'locality', class: 'city', bbox: [-105.11, 39.83, -105.00, 39.96] },
    { id: 'div-paris', primary: 'Paris', en: 'Paris', country: 'FR', region: 'FR-75', subtype: 'locality', class: 'city', bbox: [2.22, 48.81, 2.47, 48.90] },
    { id: 'div-no-bbox', primary: 'Nowhere', country: 'FR', subtype: 'locality' },
];

const fixtureNdjson = () => FIXTURE_ROWS.map(r => JSON.stringify(r)).join('\n');

describe('DivisionsSearchIndexService', () => {
    let service: DivisionsSearchIndexService;

    beforeEach(() => {
        service = new DivisionsSearchIndexService({} as GcsService);
        service.loadFromNdjson(fixtureNdjson());
    });

    it('searches by name substring, case-insensitively, across primary and en names', () => {
        const { results, totalCount } = service.search({ name: 'westminster' });
        expect(results.map(r => r.id).sort()).toEqual(['div-westminster', 'div-westminster-co']);
        expect(totalCount).toBe(2);
    });

    it('matches an exact id passed as the name', () => {
        const { results } = service.search({ name: 'div-paris' });
        expect(results.map(r => r.id)).toEqual(['div-paris']);
    });

    it('filters by subtype and country', () => {
        expect(service.search({ name: 'westminster', subtypes: ['locality'] }).results.map(r => r.id)).toEqual(['div-westminster-co']);
        expect(service.search({ name: 'westminster', country: 'GB' }).results.map(r => r.id)).toEqual(['div-westminster']);
    });

    it('filters by bbox intersection and excludes rows with no bbox', () => {
        // London-ish box
        const { results } = service.search({ bbox: [-1, 51, 1, 52] });
        expect(results.map(r => r.id)).toEqual(['div-westminster']);
    });

    it('respects the limit while reporting the full match count', () => {
        const { results, totalCount } = service.search({ name: 'westminster', limit: 1 });
        expect(results.length).toBe(1);
        expect(totalCount).toBe(2);
    });

    it('serves deterministic page windows', () => {
        const page0 = service.search({ name: 'westminster', limit: 1, page: 0 });
        const page1 = service.search({ name: 'westminster', limit: 1, page: 1 });
        const page2 = service.search({ name: 'westminster', limit: 1, page: 2 });
        expect(page0.results.length).toBe(1);
        expect(page1.results.length).toBe(1);
        expect(page0.results[0].id).not.toBe(page1.results[0].id);
        expect([...page0.results, ...page1.results].map(r => r.id).sort()).toEqual(['div-westminster', 'div-westminster-co']);
        expect(page2.results.length).toBe(0);
        expect(page2.totalCount).toBe(2);
    });

    it('returns full metadata but no geometry', () => {
        const [result] = service.search({ name: 'city of westminster' }).results;
        expect(result).toMatchObject({
            id: 'div-westminster',
            type: 'division_area',
            subtype: 'county',
            primary_name: 'City of Westminster',
            names: { primary: 'City of Westminster', common: { en: 'Westminster' } },
            country: 'GB',
            region: 'GB-WSM',
            bbox: { xmin: -0.22, ymin: 51.48, xmax: -0.11, ymax: 51.54 },
        });
        expect(result.geometry).toBeUndefined();
    });

    it('loads the artifact from GCS and becomes ready, skipping reload on same generation', async () => {
        const gcs = {
            getObjectGeneration: jest.fn().mockResolvedValue('gen-1'),
            downloadObject: jest.fn().mockResolvedValue(gzipSync(Buffer.from(fixtureNdjson()))),
        } as unknown as GcsService;
        const svc = new DivisionsSearchIndexService(gcs);

        expect(svc.isReady()).toBe(false);
        await svc.loadIfStale();
        expect(svc.isReady()).toBe(true);
        expect(svc.search({ name: 'paris' }).results.length).toBe(1);

        await svc.loadIfStale();
        expect((gcs.downloadObject as jest.Mock).mock.calls.length).toBe(1);
        expect((gcs.downloadObject as jest.Mock)).toHaveBeenCalledWith(DIVISIONS_SEARCH_INDEX_OBJECT);
    });

    it('stays not-ready when the artifact is missing', async () => {
        const gcs = {
            getObjectGeneration: jest.fn().mockResolvedValue(null),
            downloadObject: jest.fn(),
        } as unknown as GcsService;
        const svc = new DivisionsSearchIndexService(gcs);
        await svc.loadIfStale();
        expect(svc.isReady()).toBe(false);
        expect(gcs.downloadObject).not.toHaveBeenCalled();
    });
});
