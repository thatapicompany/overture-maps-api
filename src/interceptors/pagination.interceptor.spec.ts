import { of } from 'rxjs';
import { PaginationInterceptor } from './pagination.interceptor';

const makeContext = (query: any = {}) => {
  const headers: Record<string, string> = {};
  const response = { set: (k: string, v: string) => { headers[k] = v; } };
  const request = { query };
  const context: any = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  };
  return { context, headers };
};

describe('PaginationInterceptor', () => {
  const interceptor = new PaginationInterceptor();

  it('unwraps paginated envelopes and sets Pagination-* headers', (done) => {
    const { context, headers } = makeContext();
    const envelope = { results: [{ id: 'a' }, { id: 'b' }], totalCount: 123, page: 2, limit: 2 };

    interceptor.intercept(context, { handle: () => of(envelope) } as any).subscribe((body) => {
      expect(body).toEqual([{ id: 'a' }, { id: 'b' }]);
      expect(headers['Pagination-Count']).toBe('123');
      expect(headers['Pagination-Page']).toBe('2');
      expect(headers['Pagination-Limit']).toBe('2');
      expect(headers['X-Total-Count']).toBe('2');
      done();
    });
  });

  it('returns CSV text with the same headers when format=csv', (done) => {
    const { context, headers } = makeContext({ format: 'csv' });
    const envelope = {
      results: [
        { id: 'a', geometry: { type: 'Point', coordinates: [-0.1, 51.5] }, properties: { id: 'a', names: { primary: 'Café "Ünï", Ltd' }, categories: { primary: 'cafe' }, confidence: 0.9 } },
        { id: 'b', geometry: { type: 'Point', coordinates: [2, 48] }, properties: { id: 'b', names: { primary: '=SUM(A1)' } } },
      ],
      totalCount: 40,
      page: 0,
      limit: 2,
    };

    interceptor.intercept(context, { handle: () => of(envelope) } as any).subscribe((body: any) => {
      expect(headers['Content-Type']).toBe('text/csv; charset=utf-8');
      expect(headers['Pagination-Count']).toBe('40');
      expect(headers['X-Total-Count']).toBe('2');
      expect(body.charCodeAt(0)).toBe(0xfeff);
      expect(body.slice(1).split('\r\n')).toEqual([
        'id,name,category,latitude,longitude,confidence',
        'a,"Café ""Ünï"", Ltd",cafe,51.5,-0.1,0.9',
        "b,'=SUM(A1),,48,2,",
        '',
      ]);
      done();
    });
  });

  it('leaves JSON responses without a CSV content type', (done) => {
    const { context, headers } = makeContext({ format: 'json' });
    interceptor.intercept(context, { handle: () => of({ results: [{ id: 'a' }], totalCount: 1 }) } as any).subscribe((body) => {
      expect(body).toEqual([{ id: 'a' }]);
      expect(headers['Content-Type']).toBeUndefined();
      done();
    });
  });

  it('wraps paginated results as GeoJSON when format=geojson', (done) => {
    const { context, headers } = makeContext({ format: 'geojson' });
    const envelope = { results: [{ id: 'a', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }], totalCount: 1, page: 0, limit: 10 };

    interceptor.intercept(context, { handle: () => of(envelope) } as any).subscribe((body: any) => {
      expect(body.type).toBe('FeatureCollection');
      expect(body.features.length).toBe(1);
      expect(headers['Pagination-Count']).toBe('1');
      done();
    });
  });

  it('keeps legacy behaviour for plain arrays', (done) => {
    const { context, headers } = makeContext();

    interceptor.intercept(context, { handle: () => of([1, 2, 3]) } as any).subscribe((body) => {
      expect(body).toEqual([1, 2, 3]);
      expect(headers['X-Total-Count']).toBe('3');
      expect(headers['Pagination-Count']).toBe('3');
      done();
    });
  });

  it('passes through non-array, non-envelope bodies untouched', (done) => {
    const { context, headers } = makeContext();
    const single = { id: 'division-1', geometry: {} };

    interceptor.intercept(context, { handle: () => of(single) } as any).subscribe((body) => {
      expect(body).toBe(single);
      expect(headers['X-Total-Count']).toBeUndefined();
      done();
    });
  });
});
