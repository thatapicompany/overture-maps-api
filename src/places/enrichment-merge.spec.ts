import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';
import { BuildingsService } from '../buildings/buildings.service';

describe('PlacesController enrichment merge', () => {
  it('merges enrichment data into place responses', async () => {
    const samplePlace: any = {
      id: '1',
      geometry: { type: 'Point', coordinates: [0, 0] },
      version: '1',
      sources: [],
      names: { primary: 'Test' },
      categories: { primary: 'cat' },
      confidence: 1,
      addresses: [],
    };
    const placesService = { getPlaces: jest.fn().mockResolvedValue({ results: [samplePlace], totalCount: 1 }) } as unknown as PlacesService;
    const controller = new PlacesController(placesService, {} as BuildingsService, { isReady: () => false, get: () => undefined } as any);
    controller['enrichmentAdapter'] = {
      fetchEnrichmentByIds: async () => ({ '1': { foo: 'bar' } }),
      supportedFields: async () => [],
    };
    const query: any = { lat: 0, lng: 0, enrichment_fields: ['foo'] };
    const envelope: any = await controller.getPlaces(query, {} as any);
    // Controller returns a paginated envelope; the PaginationInterceptor
    // unwraps it before the client sees the response.
    expect(envelope.totalCount).toBe(1);
    expect(envelope.results[0].enrichment.fields.foo).toBe('bar');
  });
});
