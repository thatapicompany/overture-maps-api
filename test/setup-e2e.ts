// e2e test setup. Runs before the application module graph is imported, so the
// auth middleware's module-level DEMO_API_KEY constant picks this up.
//
// Production no longer ships a hardcoded demo key (see auth-api.middleware.ts);
// the e2e suite opts in to a known demo key explicitly here.
process.env.DEMO_API_KEY = process.env.DEMO_API_KEY || 'DEMO-API-KEY';
