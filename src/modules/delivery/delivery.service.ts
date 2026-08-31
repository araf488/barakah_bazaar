import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { Money } from '../../common/money/money';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { DeliveryZone, DeliveryZoneRule } from '../../infra/prisma/prisma-client';
import { DeliveryConstants, DeliveryMessages } from './delivery.constants';
import { DeliveryRepository } from './delivery.repository';
import { DeliveryQuoteDto } from './dto/delivery.dto';

/** Where an order is going, in the three fields a zone rule can match on. */
export interface DeliveryDestination {
  readonly division: string;
  readonly district: string;
  readonly unit: string;
}

/** What delivery costs, resolved. */
export interface ResolvedFee {
  readonly feePoysha: bigint;
  readonly zone: DeliveryZone;
  readonly isFree: boolean;
}

/**
 * What it costs to deliver a basket to an address.
 *
 * The fee is resolved **server-side at checkout**, never taken from the client. A delivery
 * charge the customer can choose is a delivery charge the customer will choose to be zero.
 *
 * Matching is by specificity: a rule naming a unit beats one naming only its district, which
 * beats one naming only the division. That is what lets "Dhaka division 120, except Dhaka
 * district 80, except Gulshan 60" be three rows rather than a special case, and it is why the
 * candidate rules are picked over in memory instead of by three separate queries.
 */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly repository: DeliveryRepository,
    @InjectPinoLogger(DeliveryService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * The authoritative fee for one destination and basket value.
   *
   * Returns a failure rather than zero when nothing matches and no default exists. Charging
   * nothing because pricing is misconfigured is a silent revenue leak; refusing the order is
   * loud and gets fixed.
   */
  async resolveFee(
    destination: DeliveryDestination,
    subtotalPoysha: bigint,
  ): Promise<ServiceResponse<ResolvedFee>> {
    try {
      const candidates = await this.repository.findCandidates(
        destination.division,
        destination.district,
        destination.unit,
      );

      if (candidates === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, DeliveryMessages.Unavailable);
      }

      const zone = DeliveryService.mostSpecific(candidates.rules) ?? candidates.fallback;

      if (!zone) {
        this.logger.error(
          { ...destination },
          'No delivery zone matched and no default zone is configured',
        );
        return serviceFail(HttpStatus.UNPROCESSABLE_ENTITY, DeliveryMessages.NoZoneConfigured);
      }

      return serviceOk(DeliveryService.price(zone, subtotalPoysha));
    } catch (error) {
      this.logger.error(
        { err: error, ...destination },
        'Exception occurred in DeliveryService.resolveFee',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** The same answer, shaped for the storefront to show before checkout. */
  async quote(
    destination: DeliveryDestination,
    subtotalPoysha: bigint,
  ): Promise<ServiceResponse<DeliveryQuoteDto>> {
    const resolved = await this.resolveFee(destination, subtotalPoysha);

    if (!resolved.ok) {
      return resolved;
    }

    const { feePoysha, zone, isFree } = resolved.data;

    return serviceOk({
      feePoysha: Money.toJsonNumber(feePoysha),
      zoneNameEn: zone.nameEn,
      zoneNameBn: zone.nameBn,
      isFree,
      freeDeliveryShortfallPoysha: DeliveryService.shortfall(zone, subtotalPoysha),
    });
  }

  /**
   * The winning zone among rules that all match this address.
   *
   * Specificity is counted, not assumed from query order: a rule with a unit scores 2, one
   * with only a district scores 1, one with only a division scores 0.
   */
  private static mostSpecific(
    rules: (DeliveryZoneRule & { zone: DeliveryZone })[],
  ): DeliveryZone | null {
    let best: (DeliveryZoneRule & { zone: DeliveryZone }) | null = null;
    let bestScore = -1;

    for (const rule of rules) {
      const score = DeliveryService.specificity(rule);

      if (score > bestScore) {
        best = rule;
        bestScore = score;
      }
    }

    return best ? best.zone : null;
  }

  private static specificity(rule: DeliveryZoneRule): number {
    if (rule.unit) {
      return 2;
    }

    return rule.district ? 1 : 0;
  }

  /** Applies the zone's free-delivery threshold to a basket value. */
  private static price(zone: DeliveryZone, subtotalPoysha: bigint): ResolvedFee {
    const qualifies = zone.freeAbovePoysha !== null && subtotalPoysha >= zone.freeAbovePoysha;

    return {
      feePoysha: qualifies ? 0n : zone.feePoysha,
      zone,
      isFree: qualifies || zone.feePoysha === 0n,
    };
  }

  /** How much more this basket needs to earn free delivery, or null where it never can. */
  private static shortfall(zone: DeliveryZone, subtotalPoysha: bigint): number | null {
    if (zone.freeAbovePoysha === null || subtotalPoysha >= zone.freeAbovePoysha) {
      return null;
    }

    return Money.toJsonNumber(zone.freeAbovePoysha - subtotalPoysha);
  }

  /** Exposed so the admin service and the seed share one page-size rule. */
  static get defaultPageSize(): number {
    return DeliveryConstants.DefaultPageSize;
  }
}
