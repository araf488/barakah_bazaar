import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { GeoapifyGeocodingGateway } from './geoapify-geocoding.gateway';
import { NoopGeocodingGateway } from './noop-geocoding.gateway';
import { PhotonGeocodingGateway } from './photon-geocoding.gateway';

/** GeoJSON orders coordinates [longitude, latitude] — the order these tests pin down. */
const photonPayload = {
  features: [
    {
      geometry: { coordinates: [90.4078, 23.7925] },
      properties: {
        name: 'Gulshan 1',
        district: 'Gulshan',
        city: 'Dhaka',
        postcode: '1212',
        countrycode: 'BD',
      },
    },
  ],
};

const geoapifyPayload = {
  features: [
    { properties: { formatted: 'Gulshan 1, Dhaka', lat: 23.7925, lon: 90.4078, postcode: '1212' } },
  ],
};

describe('NoopGeocodingGateway', () => {
  const gateway = new NoopGeocodingGateway();

  it('reports itself unconfigured so the service answers 503', () => {
    expect(gateway.isConfigured).toBe(false);
    expect(gateway.name).toBe('noop');
  });

  it('returns null from both operations', async () => {
    await expect(gateway.search()).resolves.toBeNull();
    await expect(gateway.reverse()).resolves.toBeNull();
  });
});

describe('PhotonGeocodingGateway', () => {
  let logger: jest.Mocked<PinoLogger>;
  let fetcher: jest.Mock;
  let gateway: PhotonGeocodingGateway;

  beforeEach(() => {
    logger = createMockLogger();
    fetcher = jest.fn();
    gateway = new PhotonGeocodingGateway('https://photon.test', logger, fetcher);
  });

  it('needs no key, so it is always configured', () => {
    expect(gateway.isConfigured).toBe(true);
  });

  it('reads longitude and latitude in GeoJSON order, not the reverse', async () => {
    fetcher.mockResolvedValue(photonPayload);

    const places = await gateway.search('gulshan', 5);

    // Swapping these would place every Bangladeshi address off the coast of Somalia.
    expect(places?.[0].latitude).toBeCloseTo(23.7925, 4);
    expect(places?.[0].longitude).toBeCloseTo(90.4078, 4);
  });

  it('builds a readable label and carries the post code', async () => {
    fetcher.mockResolvedValue(photonPayload);

    const places = await gateway.search('gulshan', 5);

    expect(places?.[0].label).toBe('Gulshan 1, Gulshan, Dhaka');
    expect(places?.[0].postCode).toBe('1212');
  });

  it('biases the query towards Bangladesh and passes the limit through', async () => {
    fetcher.mockResolvedValue({ features: [] });

    await gateway.search('gulshan 2', 7);

    const url = fetcher.mock.calls[0][0] as string;
    expect(url).toContain('q=gulshan%202');
    expect(url).toContain('limit=7');
    expect(url).toContain('lat=23.8103');
  });

  it('drops results outside Bangladesh', async () => {
    fetcher.mockResolvedValue({
      features: [
        {
          geometry: { coordinates: [2.35, 48.85] },
          properties: { name: 'Paris', countrycode: 'FR' },
        },
      ],
    });

    await expect(gateway.search('paris', 5)).resolves.toEqual([]);
  });

  it('returns an empty list — not null — when the provider found nothing', async () => {
    fetcher.mockResolvedValue({ features: [] });

    await expect(gateway.search('nowhere', 5)).resolves.toEqual([]);
  });

  it('returns null and logs when the call fails', async () => {
    const failure = new Error('geocoder responded 503');
    fetcher.mockRejectedValue(failure);

    await expect(gateway.search('gulshan', 5)).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure, provider: 'photon' }),
      'Exception occurred in PhotonGeocodingGateway.search',
    );
  });

  it('never logs the customer-entered query', async () => {
    fetcher.mockRejectedValue(new Error('boom'));

    await gateway.search('flat 3 secret street', 5);

    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret street');
  });

  it('reverse-geocodes to the first result', async () => {
    fetcher.mockResolvedValue(photonPayload);

    const place = await gateway.reverse(23.7925, 90.4078);

    expect(place?.label).toBe('Gulshan 1, Gulshan, Dhaka');
    expect(fetcher.mock.calls[0][0]).toContain('/reverse?lat=23.7925&lon=90.4078');
  });

  it('returns null from reverse when nothing matched', async () => {
    fetcher.mockResolvedValue({ features: [] });

    await expect(gateway.reverse(0, 0)).resolves.toBeNull();
  });

  it('tolerates a malformed payload instead of throwing', async () => {
    fetcher.mockResolvedValue({ features: [{ geometry: {}, properties: {} }] });

    await expect(gateway.search('x', 5)).resolves.toEqual([]);
  });
});

describe('GeoapifyGeocodingGateway', () => {
  let logger: jest.Mocked<PinoLogger>;
  let fetcher: jest.Mock;
  let gateway: GeoapifyGeocodingGateway;

  beforeEach(() => {
    logger = createMockLogger();
    fetcher = jest.fn();
    gateway = new GeoapifyGeocodingGateway('https://geoapify.test', 'secret-key', logger, fetcher);
  });

  it('is unconfigured without a key', () => {
    const keyless = new GeoapifyGeocodingGateway(
      'https://geoapify.test',
      undefined,
      logger,
      fetcher,
    );

    expect(keyless.isConfigured).toBe(false);
    expect(gateway.isConfigured).toBe(true);
  });

  it('maps the flat lat/lon properties Geoapify returns', async () => {
    fetcher.mockResolvedValue(geoapifyPayload);

    const places = await gateway.search('gulshan', 5);

    expect(places?.[0]).toEqual({
      label: 'Gulshan 1, Dhaka',
      latitude: 23.7925,
      longitude: 90.4078,
      postCode: '1212',
    });
  });

  it('restricts results to Bangladesh', async () => {
    fetcher.mockResolvedValue({ features: [] });

    await gateway.search('gulshan', 5);

    expect(fetcher.mock.calls[0][0]).toContain('filter=countrycode:bd');
  });

  it('returns null and logs without leaking the API key', async () => {
    fetcher.mockRejectedValue(new Error('boom'));

    await expect(gateway.search('gulshan', 5)).resolves.toBeNull();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret-key');
  });

  it('reverse-geocodes to the first result', async () => {
    fetcher.mockResolvedValue(geoapifyPayload);

    await expect(gateway.reverse(23.7925, 90.4078)).resolves.toEqual(
      expect.objectContaining({ label: 'Gulshan 1, Dhaka' }),
    );
  });
});
