import * as request from 'supertest';

// Use a long timeout since live external queries can take time
jest.setTimeout(30000);

describe('Live Production Endpoints (e2e)', () => {
    const apiKey = process.env.TEST_API_KEY || 'DEMO-API-KEY';
    const baseUrl = 'https://api.overturemapsapi.com';

    // Base coords for testing
    const lat = 37.7749;
    const lng = -122.4194;
    const radius = 100;
    const limit = 2; // small limit to reduce backend costs
    const queryParams = `lat=${lat}&lng=${lng}&radius=${radius}&limit=${limit}`;

    it('should have an API key', () => {
        expect(apiKey).toBeDefined();
    });

    it('/addresses (GET) live', async () => {
        const response = await request(baseUrl)
            .get(`/addresses?${queryParams}`)
            .set('x-api-key', apiKey);

        expect(response.status).toBe(200);
        expect(response.body).toBeInstanceOf(Array);
    });

    it('/base (GET) live', async () => {
        const response = await request(baseUrl)
            .get(`/base?${queryParams}`)
            .set('x-api-key', apiKey);

        expect(response.status).toBe(200);
        expect(response.body).toBeInstanceOf(Array);
    });

    it('/buildings (GET) live', async () => {
        const response = await request(baseUrl)
            .get(`/buildings?${queryParams}`)
            .set('x-api-key', apiKey);

        expect(response.status).toBe(200);
        expect(response.body).toBeInstanceOf(Array);
    });

    it('/transportation (GET) live', async () => {
        const response = await request(baseUrl)
            .get(`/transportation?${queryParams}`)
            .set('x-api-key', apiKey);

        expect(response.status).toBe(200);
        expect(response.body).toBeInstanceOf(Array);
    });

    it('/divisions (GET) live', async () => {
        const response = await request(baseUrl)
            .get(`/divisions?${queryParams}`)
            .set('x-api-key', apiKey);

        expect(response.status).toBe(200);
        expect(response.body).toBeInstanceOf(Array);
    });
});
