import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages, formatMessage } from '../../common/constants/error-messages.constants';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { BANGLADESH_DIVISIONS, GeoAreaData, GeoUnitData } from './bangladesh-geo.data';
import {
  DISTRICT_BY_KEY,
  DIVISION_BY_KEY,
  UNIT_BY_KEY,
  findArea,
  unitKey,
} from './bangladesh-geo.index';
import {
  GeoAreaDto,
  GeoAreaListDto,
  GeoDistrictDto,
  GeoDivisionDto,
  GeoUnitDto,
} from './dto/geo-response.dto';
import { GeoMessages } from './geo.constants';
import {
  GeoResolveLinkDto,
  GeoReverseQueryDto,
  GeoSearchQueryDto,
  GeocodedPlaceDto,
  ResolvedLocationDto,
} from './dto/geocoding.dto';
import { GoogleMapsLink } from './google-maps-link';
import { UrlResolver } from './gateways/json-fetcher';
import { GeoTokens, GeocodedPlace, GeocodingProvider } from './ports/geocoding.port';

/**
 * Bangladesh geography, served from a vendored dataset merged from four sources.
 *
 * Synchronous by design: the data is a frozen in-memory constant, so there is no I/O to
 * await. `validateChain` is the single gate every address write goes through — four
 * individually valid fields that do not compose is the characteristic bug here, and only a
 * chain check catches it.
 *
 * Lookups below district level are ALWAYS scoped by their parent: "Kaliganj" names four
 * different upazilas and "Durgapur" fourteen different unions, so a bare-name lookup would
 * silently resolve an address to the wrong place.
 */
@Injectable()
export class GeoService {
  constructor(
    @Inject(GeoTokens.GeocodingProvider) private readonly geocoder: GeocodingProvider,
    @InjectPinoLogger(GeoService.name) private readonly logger: PinoLogger,
    /** Injected so tests never issue a real redirect request. */
    @Inject(GeoTokens.UrlResolver) private readonly followRedirect: UrlResolver,
  ) {}

  listDivisions(): ServiceResponse<GeoDivisionDto[]> {
    try {
      return serviceOk(
        BANGLADESH_DIVISIONS.map((division) => ({
          nameEn: division.nameEn,
          nameBn: division.nameBn,
          districtCount: division.districts.length,
        })),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in GeoService.listDivisions');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  listDistricts(division: string): ServiceResponse<GeoDistrictDto[]> {
    try {
      const found = DIVISION_BY_KEY.get(GeoService.key(division));

      if (!found) {
        return serviceFail(
          HttpStatus.NOT_FOUND,
          formatMessage(GeoMessages.UnknownDivisionTemplate, division),
        );
      }

      return serviceOk(
        found.districts.map((district) => ({
          nameEn: district.nameEn,
          nameBn: district.nameBn,
          divisionEn: found.nameEn,
          unitCount: district.units.length,
        })),
      );
    } catch (error) {
      this.logger.error({ err: error, division }, 'Exception occurred in GeoService.listDistricts');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  listUnits(district: string): ServiceResponse<GeoUnitDto[]> {
    try {
      const located = DISTRICT_BY_KEY.get(GeoService.key(district));

      if (!located) {
        return serviceFail(
          HttpStatus.NOT_FOUND,
          formatMessage(GeoMessages.UnknownDistrictTemplate, district),
        );
      }

      return serviceOk(
        located.district.units.map((unit) => GeoService.toUnitDto(unit, located.district.nameEn)),
      );
    } catch (error) {
      this.logger.error({ err: error, district }, 'Exception occurred in GeoService.listUnits');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  listAreas(district: string, unit: string): ServiceResponse<GeoAreaListDto> {
    try {
      if (!DISTRICT_BY_KEY.has(GeoService.key(district))) {
        return serviceFail(
          HttpStatus.NOT_FOUND,
          formatMessage(GeoMessages.UnknownDistrictTemplate, district),
        );
      }

      const located = UNIT_BY_KEY.get(unitKey(district, unit));

      if (!located) {
        return serviceFail(
          HttpStatus.NOT_FOUND,
          formatMessage(GeoMessages.UnitNotInDistrictTemplate, unit, district),
        );
      }

      return serviceOk({
        divisionEn: located.division.nameEn,
        districtEn: located.district.nameEn,
        unitEn: located.unit.nameEn,
        areas: located.unit.areas.map((area) => GeoService.toAreaDto(area)),
      });
    } catch (error) {
      this.logger.error(
        { err: error, district, unit },
        'Exception occurred in GeoService.listAreas',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Validates division → district → unit → area as one chain. Returns 400 rather than 404
   * because this judges a submitted payload, not a looked-up resource.
   *
   * `area` is optional: a unit may legitimately have none, so omitting it passes at the unit
   * level. That is correct, not a loophole — but a value that IS supplied must belong.
   */
  validateChain(
    division: string,
    district: string,
    unit: string,
    area?: string | null,
  ): ServiceResponse<void> {
    try {
      const foundDivision = DIVISION_BY_KEY.get(GeoService.key(division));

      if (!foundDivision) {
        return serviceFail(
          HttpStatus.BAD_REQUEST,
          formatMessage(GeoMessages.UnknownDivisionTemplate, division),
        );
      }

      const locatedDistrict = DISTRICT_BY_KEY.get(GeoService.key(district));

      if (!locatedDistrict || locatedDistrict.division.nameEn !== foundDivision.nameEn) {
        return serviceFail(
          HttpStatus.BAD_REQUEST,
          formatMessage(GeoMessages.DistrictNotInDivisionTemplate, district, foundDivision.nameEn),
        );
      }

      const locatedUnit = UNIT_BY_KEY.get(unitKey(district, unit));

      if (!locatedUnit || locatedUnit.district.nameEn !== locatedDistrict.district.nameEn) {
        return serviceFail(
          HttpStatus.BAD_REQUEST,
          formatMessage(
            GeoMessages.UnitNotInDistrictTemplate,
            unit,
            locatedDistrict.district.nameEn,
          ),
        );
      }

      return GeoService.validateArea(locatedUnit.unit, area);
    } catch (error) {
      this.logger.error(
        { err: error, division, district, unit },
        'Exception occurred in GeoService.validateChain',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * Validates only division → district.
   *
   * Used when a customer says their area is not in our list and typed it themselves. These
   * two levels stay mandatory because they are complete and authoritative (8 and 64) and are
   * what delivery routing needs; the levels below them are where our coverage runs out.
   */
  validateDistrict(division: string, district: string): ServiceResponse<void> {
    try {
      const foundDivision = DIVISION_BY_KEY.get(GeoService.key(division));

      if (!foundDivision) {
        return serviceFail(
          HttpStatus.BAD_REQUEST,
          formatMessage(GeoMessages.UnknownDivisionTemplate, division),
        );
      }

      const located = DISTRICT_BY_KEY.get(GeoService.key(district));

      if (!located || located.division.nameEn !== foundDivision.nameEn) {
        return serviceFail(
          HttpStatus.BAD_REQUEST,
          formatMessage(GeoMessages.DistrictNotInDivisionTemplate, district, foundDivision.nameEn),
        );
      }

      return serviceOk<void>(undefined);
    } catch (error) {
      this.logger.error(
        { err: error, division, district },
        'Exception occurred in GeoService.validateDistrict',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Extracted so `validateChain` stays well inside the complexity budget. */
  private static validateArea(unit: GeoUnitData, area?: string | null): ServiceResponse<void> {
    const wanted = area?.trim();

    if (!wanted) {
      return serviceOk<void>(undefined);
    }

    if (!findArea(unit, wanted)) {
      return serviceFail(
        HttpStatus.BAD_REQUEST,
        formatMessage(GeoMessages.AreaNotInUnitTemplate, wanted, unit.nameEn),
      );
    }

    return serviceOk<void>(undefined);
  }

  private static key(value: string): string {
    return value.trim().toLowerCase();
  }

  private static toUnitDto(unit: GeoUnitData, districtEn: string): GeoUnitDto {
    return {
      nameEn: unit.nameEn,
      nameBn: unit.nameBn,
      kind: unit.kind,
      districtEn,
      areaCount: unit.areas.length,
    };
  }

  private static toAreaDto(area: GeoAreaData): GeoAreaDto {
    return {
      nameEn: area.nameEn,
      nameBn: area.nameBn,
      kind: area.kind,
      postCode: area.postCode,
      latitude: area.latitude,
      longitude: area.longitude,
    };
  }

  /**
   * Free-text place search, proxied to the configured provider.
   *
   * Async unlike the rest of this service — these two are the only methods that do I/O.
   * A `null` from the provider is a failure (503), an empty array is a genuine miss (200).
   */
  async searchPlaces(query: GeoSearchQueryDto): Promise<ServiceResponse<GeocodedPlaceDto[]>> {
    try {
      if (!this.geocoder.isConfigured) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, GeoMessages.GeocodingDisabled);
      }

      const places = await this.geocoder.search(query.q, query.limit);

      if (places === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, GeoMessages.GeocodingUnavailable);
      }

      return serviceOk(places.map((place) => GeoService.toPlaceDto(place)));
    } catch (error) {
      this.logger.error(
        { err: error, provider: this.geocoder.name },
        'Exception occurred in GeoService.searchPlaces',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Reverse-geocodes a dropped pin so the customer can confirm what they selected. */
  async reverseGeocode(query: GeoReverseQueryDto): Promise<ServiceResponse<GeocodedPlaceDto>> {
    try {
      if (!this.geocoder.isConfigured) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, GeoMessages.GeocodingDisabled);
      }

      const place = await this.geocoder.reverse(query.lat, query.lng);

      if (place === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, GeoMessages.GeocodingUnavailable);
      }

      return serviceOk(GeoService.toPlaceDto(place));
    } catch (error) {
      this.logger.error(
        { err: error, provider: this.geocoder.name },
        'Exception occurred in GeoService.reverseGeocode',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  private static toPlaceDto(place: GeocodedPlace): GeocodedPlaceDto {
    return {
      label: place.label,
      latitude: place.latitude,
      longitude: place.longitude,
      postCode: place.postCode ?? null,
    };
  }

  /**
   * Resolves a location a customer pasted from Google Maps.
   *
   * Many Bangladeshi buildings have no useful street address, so a shared map link is often
   * the most precise thing a customer can give. Short links carry no coordinates until
   * followed, so those are resolved first — and ONLY when the host passes the allowlist,
   * because following a customer-supplied URL is otherwise an SSRF hole.
   *
   * Coordinates are all this returns. The administrative address still comes from the
   * vendored dataset, so a pasted link can never write an unroutable address.
   */
  async resolveMapLink(dto: GeoResolveLinkDto): Promise<ServiceResponse<ResolvedLocationDto>> {
    try {
      const coordinates = await this.extractCoordinates(dto.link);

      if (!coordinates) {
        return serviceFail(HttpStatus.BAD_REQUEST, GeoMessages.UnreadableMapLink);
      }

      // Best-effort: a description is a nicety, so a geocoder outage must not fail the paste.
      const described = this.geocoder.isConfigured
        ? await this.geocoder.reverse(coordinates.latitude, coordinates.longitude)
        : null;

      return serviceOk({
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        label: described?.label ?? null,
        postCode: described?.postCode ?? null,
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in GeoService.resolveMapLink');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Parses directly, or follows one allowlisted short link and parses the destination. */
  private async extractCoordinates(
    link: string,
  ): Promise<{ latitude: number; longitude: number } | null> {
    const direct = GoogleMapsLink.parse(link);

    if (direct) {
      return direct;
    }

    if (!GoogleMapsLink.isShortLink(link) || !GoogleMapsLink.isFollowableUrl(link)) {
      return null;
    }

    try {
      return GoogleMapsLink.parse(await this.followRedirect(link));
    } catch (error) {
      // The pasted link is not logged: it points at the customer's home.
      this.logger.warn({ err: error }, 'Could not follow a shortened map link');
      return null;
    }
  }
}
