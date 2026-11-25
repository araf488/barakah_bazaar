import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../test/fixtures';
import { fetchAreas, fetchDistricts, fetchUnits } from '../../geo';

describe('geo client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('asks the same-origin API for each level, escaping names', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', undefined);
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchDistricts('Dhaka');
    await fetchUnits("Cox's Bazar");

    expect(fetchMock.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      '/api/v1/geo/divisions/Dhaka/districts',
      "/api/v1/geo/districts/Cox's%20Bazar/units",
    ]);
  });

  it('unwraps the area list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          divisionEn: 'Dhaka',
          districtEn: 'Dhaka',
          unitEn: 'Gulshan',
          areas: [{ nameEn: 'Banani', nameBn: 'বনানী', postCode: '1213' }],
        }),
      ),
    );
    await expect(fetchAreas('Dhaka', 'Gulshan')).resolves.toEqual([
      { nameEn: 'Banani', nameBn: 'বনানী', postCode: '1213' },
    ]);
  });
});
