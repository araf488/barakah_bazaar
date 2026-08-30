import { HttpStatus, Injectable } from '@nestjs/common';
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
  constructor(@InjectPinoLogger(GeoService.name) private readonly logger: PinoLogger) {}

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
}
