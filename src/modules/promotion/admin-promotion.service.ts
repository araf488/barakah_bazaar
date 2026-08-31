import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ErrorMessageTemplates,
  ErrorMessages,
  formatMessage,
} from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { Promotion, PromotionType } from '../../infra/prisma/prisma-client';
import { AdminAuditActions, AdminAuditEntities } from '../admin/admin.constants';
import { AuditLogWriteData } from '../admin/audit-log.repository';
import { AuthService } from '../auth/auth.service';
import { PromotionConstants, PromotionMessages } from './promotion.constants';
import { PromotionMapper } from './promotion.mapper';
import { PromotionRepository, PromotionWriteData } from './promotion.repository';
import { PromotionService } from './promotion.service';
import { PromotionDto, PromotionListDto, UpsertPromotionDto } from './dto/promotion.dto';

/**
 * Managing promo codes.
 *
 * The validation here exists because the alternatives are all silent. An uncapped percentage
 * looks fine until a large basket wipes out its own margin; a percentage of 150 is not a
 * discount but a payment; and an end date before the start creates a code that can never be
 * used and nobody notices until a campaign flops.
 */
@Injectable()
export class AdminPromotionService {
  constructor(
    private readonly repository: PromotionRepository,
    private readonly authService: AuthService,
    @InjectPinoLogger(AdminPromotionService.name) private readonly logger: PinoLogger,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: UpsertPromotionDto,
  ): Promise<ServiceResponse<PromotionDto>> {
    try {
      const staff = await this.authService.resolveActiveUserId(actor);
      if (!staff.ok) {
        return staff;
      }

      const data = AdminPromotionService.toWriteData(dto);

      const invalid = AdminPromotionService.assertCoherent(data);
      if (invalid) {
        return invalid;
      }

      const existing = await this.repository.findByCode(data.code);

      if (existing === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PromotionMessages.Unavailable);
      }

      if (existing) {
        return serviceFail(HttpStatus.CONFLICT, PromotionMessages.CodeExists);
      }

      const created = await this.repository.createAudited(data, (row) =>
        AdminPromotionService.audit(
          staff.data,
          actor,
          AdminAuditActions.PromotionCreated,
          row,
          null,
        ),
      );

      if (!created) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PromotionMessages.AuditTrailUnavailable);
      }

      return serviceOk(PromotionMapper.toDto(created));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminPromotionService.create');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpsertPromotionDto,
  ): Promise<ServiceResponse<PromotionDto>> {
    try {
      const staff = await this.authService.resolveActiveUserId(actor);
      if (!staff.ok) {
        return staff;
      }

      const existing = await this.repository.findById(id);

      if (existing === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PromotionMessages.Unavailable);
      }

      if (existing === undefined) {
        return serviceFail(
          HttpStatus.NOT_FOUND,
          formatMessage(ErrorMessageTemplates.NotFound, PromotionConstants.ResourceName),
        );
      }

      const data = AdminPromotionService.toWriteData(dto);

      const invalid = AdminPromotionService.assertCoherent(data);
      if (invalid) {
        return invalid;
      }

      const updated = await this.repository.updateAudited(id, data, (row) =>
        AdminPromotionService.audit(
          staff.data,
          actor,
          AdminAuditActions.PromotionUpdated,
          row,
          existing,
        ),
      );

      if (!updated) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PromotionMessages.AuditTrailUnavailable);
      }

      return serviceOk(PromotionMapper.toDto(updated));
    } catch (error) {
      this.logger.error(
        { err: error, promotionId: id },
        'Exception occurred in AdminPromotionService.update',
      );
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async list(page: number, pageSize: number): Promise<ServiceResponse<PromotionListDto>> {
    try {
      const result = await this.repository.findPage({}, (page - 1) * pageSize, pageSize);

      if (result === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, PromotionMessages.Unavailable);
      }

      return serviceOk({
        items: result.items.map((row) => PromotionMapper.toDto(row)),
        total: result.total,
        page,
        pageSize,
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminPromotionService.list');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /** Every way a promotion can be internally contradictory. */
  private static assertCoherent(data: PromotionWriteData): ServiceResponse<never> | null {
    if (
      data.type === PromotionType.PERCENTAGE &&
      (data.value < PromotionConstants.MinPercent || data.value > PromotionConstants.MaxPercent)
    ) {
      return serviceFail(HttpStatus.BAD_REQUEST, PromotionMessages.InvalidPercent);
    }

    if (data.maxDiscountPoysha !== null && data.type !== PromotionType.PERCENTAGE) {
      // A cap on a fixed amount is just a smaller fixed amount, and a cap on free delivery is
      // meaningless. Accepting either would silently ignore what the operator typed.
      return serviceFail(HttpStatus.BAD_REQUEST, PromotionMessages.CapOnlyForPercentage);
    }

    if (data.endsAt !== null && data.endsAt.getTime() <= data.startsAt.getTime()) {
      return serviceFail(HttpStatus.BAD_REQUEST, PromotionMessages.EndBeforeStart);
    }

    return null;
  }

  private static toWriteData(dto: UpsertPromotionDto): PromotionWriteData {
    return {
      code: PromotionService.normalise(dto.code),
      nameEn: dto.nameEn,
      nameBn: dto.nameBn ?? null,
      type: dto.type,
      value: BigInt(dto.value),
      minSubtotalPoysha: BigInt(dto.minSubtotalPoysha ?? 0),
      maxDiscountPoysha:
        dto.maxDiscountPoysha === undefined || dto.maxDiscountPoysha === null
          ? null
          : BigInt(dto.maxDiscountPoysha),
      startsAt: new Date(dto.startsAt),
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      usageLimit: dto.usageLimit ?? null,
      perCustomerLimit: dto.perCustomerLimit ?? null,
      isActive: dto.isActive ?? true,
    };
  }

  private static audit(
    actorId: string,
    actor: AuthenticatedUser,
    action: string,
    after: Promotion,
    before: Promotion | null,
  ): AuditLogWriteData {
    return {
      actorId,
      actorEmail: actor.email ?? null,
      actorRole: actor.role,
      action,
      entityType: AdminAuditEntities.Promotion,
      entityId: after.id,
      before: AdminPromotionService.toJson(before),
      after: AdminPromotionService.toJson(after),
      requestId: null,
    };
  }

  /** Explicit BigInt replacer rather than the global hook main.ts installs. */
  private static toJson(row: Promotion | null): AuditLogWriteData['before'] {
    if (!row) {
      return undefined;
    }

    return JSON.parse(
      JSON.stringify(row, (_key, item: unknown) =>
        typeof item === 'bigint' ? Number(item) : item,
      ),
    ) as AuditLogWriteData['before'];
  }
}
