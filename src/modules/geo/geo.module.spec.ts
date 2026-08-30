import { createMockConfig, createMockLogger } from '../../../test/support/mocks';
import { createGeocodingProvider } from './geo.module';

const config = (values: Record<string, unknown>) =>
  createMockConfig({
    PHOTON_API_URL: 'https://photon.test',
    GEOAPIFY_API_URL: 'https://geoapify.test',
    ...values,
  });

describe('createGeocodingProvider', () => {
  const logger = createMockLogger();

  it('selects Photon when configured, which needs no key', () => {
    const provider = createGeocodingProvider(config({ GEOCODING_PROVIDER: 'photon' }), logger);

    expect(provider.name).toBe('photon');
    expect(provider.isConfigured).toBe(true);
  });

  it('selects Geoapify when a key is present', () => {
    const provider = createGeocodingProvider(
      config({ GEOCODING_PROVIDER: 'geoapify', GEOAPIFY_API_KEY: 'a-key' }),
      logger,
    );

    expect(provider.name).toBe('geoapify');
    expect(provider.isConfigured).toBe(true);
  });

  it('falls back to noop when Geoapify is chosen without a key', () => {
    // A misconfiguration should disable map search, not 401 on every request.
    const provider = createGeocodingProvider(config({ GEOCODING_PROVIDER: 'geoapify' }), logger);

    expect(provider.name).toBe('noop');
    expect(provider.isConfigured).toBe(false);
  });

  it('selects noop when asked, so no third party is ever called', () => {
    const provider = createGeocodingProvider(config({ GEOCODING_PROVIDER: 'noop' }), logger);

    expect(provider.name).toBe('noop');
  });

  it('falls back to noop for an unrecognised provider rather than crashing at boot', () => {
    const provider = createGeocodingProvider(config({ GEOCODING_PROVIDER: 'nonesuch' }), logger);

    expect(provider.name).toBe('noop');
  });
});
