import { browserApiBaseUrl } from './api/config';
import { getJson } from './api/http';

// Browser client for the API's public Bangladesh place list (src/modules/geo). Names are
// bilingual; the address book stores and validates the English ones.

export interface GeoPlace {
  nameEn: string;
  nameBn: string | null;
}

export interface GeoArea extends GeoPlace {
  postCode: string | null;
}

const enc = encodeURIComponent;
const geo = (path: string) => `${browserApiBaseUrl()}/geo${path}`;

export const fetchDivisions = () => getJson<GeoPlace[]>(geo('/divisions'));
export const fetchDistricts = (division: string) =>
  getJson<GeoPlace[]>(geo(`/divisions/${enc(division)}/districts`));
export const fetchUnits = (district: string) =>
  getJson<GeoPlace[]>(geo(`/districts/${enc(district)}/units`));
export const fetchAreas = async (district: string, unit: string): Promise<GeoArea[]> =>
  (await getJson<{ areas: GeoArea[] }>(geo(`/districts/${enc(district)}/units/${enc(unit)}/areas`)))
    .areas;
