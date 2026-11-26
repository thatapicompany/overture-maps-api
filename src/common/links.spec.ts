import { tagged } from './links';

describe('tagged', () => {
  it('adds campaign tags to links to our own sites', () => {
    expect(tagged('https://app.overturemapsapi.com', 'demo_limit')).toBe(
      'https://app.overturemapsapi.com/?utm_source=overture_api&utm_medium=api_response&utm_campaign=demo_limit',
    );
    expect(tagged('https://www.overturemapsapi.com/pricing', 'paid_only')).toContain('/pricing?utm_source=overture_api');
  });

  it('leaves other sites and anything that is not a URL alone', () => {
    expect(tagged('https://maps.example.test/signup', 'demo_limit')).toBe('https://maps.example.test/signup');
    expect(tagged('not a url', 'demo_limit')).toBe('not a url');
  });
});
