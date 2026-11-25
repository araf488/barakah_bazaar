import { Money } from '../../common/money/money';
import { DeliveryZoneDto } from './dto/delivery.dto';
import { ZoneWithRules } from './delivery.repository';

export const DeliveryMapper = {
  toZoneDto(zone: ZoneWithRules): DeliveryZoneDto {
    return {
      id: zone.id,
      nameEn: zone.nameEn,
      nameBn: zone.nameBn,
      feePoysha: Money.toJsonNumber(zone.feePoysha),
      freeAbovePoysha:
        zone.freeAbovePoysha === null ? null : Money.toJsonNumber(zone.freeAbovePoysha),
      isDefault: zone.isDefault,
      isActive: zone.isActive,
      sortOrder: zone.sortOrder,
      rules: zone.rules.map((rule) => ({
        division: rule.division,
        district: rule.district,
        unit: rule.unit,
      })),
    };
  },
} as const;
