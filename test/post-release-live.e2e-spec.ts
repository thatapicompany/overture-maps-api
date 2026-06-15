import * as request from 'supertest';

// Use a long timeout since live external queries can take time
jest.setTimeout(30000);

// This suite hits the live deployed API, so it depends on a valid API key being
// present in the environment. Without one it cannot authenticate and would fail
// the PR gate for reasons unrelated to the change under test, so skip it unless
// TEST_API_KEY is configured (the live-e2e workflow provides it).
const apiKey = process.env.TEST_API_KEY;
const describeLive = apiKey ? describe : describe.skip;

describeLive('Live Production Endpoints (e2e)', () => {
    const baseUrl = 'https://api.overturemapsapi.com';

    // Base coords for testing. Use a demo city (New York) so that demo-account
    // keys pass the demo-location geo-fence; full-account keys work anywhere.
    const lat = 40.7128;
    const lng = -74.0060;
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
