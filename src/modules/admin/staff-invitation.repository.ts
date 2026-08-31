import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  Prisma,
  StaffInvitation,
  StaffInvitationStatus,
  UserRole,
} from '../../infra/prisma/prisma-client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogRepository, AuditLogWriteData } from './audit-log.repository';

/** `undefined` means no such row; `null` means the query itself failed. */
export type InvitationResult = StaffInvitation | null | undefined;

export interface CreateInvitationData {
  email: string;
  role: UserRole;
  tokenHash: string;
  expiresAt: Date;
  invitedBy: string;
}

export interface InvitationPage {
  items: StaffInvitation[];
  total: number;
}

@Injectable()
export class StaffInvitationRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogRepository,
    @InjectPinoLogger(StaffInvitationRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Creates the invitation and its audit row in ONE transaction.
   *
   * An invitation is a pending permission grant, so the same rule as a price change applies:
   * one that exists without a record of who sent it must not be possible.
   */
  async createAudited(
    data: CreateInvitationData,
    audit: (created: StaffInvitation) => AuditLogWriteData,
  ): Promise<StaffInvitation | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.staffInvitation.create({ data });
        await this.auditLog.appendWithin(tx, audit(created));
        return created;
      });
    } catch (error) {
      // A duplicate token hash lands here. It is astronomically unlikely with 32 bytes of
      // entropy, and the unique index is what makes it an error rather than a silent overwrite.
      this.logger.error(
        { err: error, email: data.email },
        'Exception occurred in StaffInvitationRepository.createAudited',
      );
      return null;
    }
  }

  /**
   * Moves an invitation out of PENDING, with its audit row, in one transaction.
   *
   * The `status: PENDING` in the where clause is the concurrency guard: two acceptances of
   * the same token race, and the loser updates nothing and gets a null rather than closing an
   * invitation twice.
   */
  async settleAudited(
    id: string,
    // Unchecked: the checked variant hides acceptedBy/revokedBy behind their relations, and
    // this write only ever sets the scalar it already has an id for.
    data: Prisma.StaffInvitationUncheckedUpdateManyInput,
    audit: (updated: StaffInvitation) => AuditLogWriteData,
  ): Promise<StaffInvitation | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const affected = await tx.staffInvitation.updateMany({
          where: { id, status: StaffInvitationStatus.PENDING },
          data,
        });

        if (affected.count === 0) {
          // Someone else settled it first. Not an error, but not this caller's write either.
          throw new InvitationNoLongerPendingError();
        }

        const updated = await tx.staffInvitation.findUniqueOrThrow({ where: { id } });
        await this.auditLog.appendWithin(tx, audit(updated));
        return updated;
      });
    } catch (error) {
      if (error instanceof InvitationNoLongerPendingError) {
        // Expected outcome of a race, not a fault. Logged at info so a genuine spike is
        // still visible without filling the error log.
        this.logger.info({ invitationId: id }, 'Invitation was already settled by someone else');
        return null;
      }

      this.logger.error(
        { err: error, invitationId: id },
        'Exception occurred in StaffInvitationRepository.settleAudited',
      );
      return null;
    }
  }

  /** Looks an invitation up by the hash of the token that was emailed. */
  async findByTokenHash(tokenHash: string): Promise<InvitationResult> {
    try {
      return (await this.prisma.staffInvitation.findUnique({ where: { tokenHash } })) ?? undefined;
    } catch (error) {
      // The hash is not logged: it is the stored half of a live credential.
      this.logger.error(
        { err: error },
        'Exception occurred in StaffInvitationRepository.findByTokenHash',
      );
      return null;
    }
  }

  async findById(id: string): Promise<InvitationResult> {
    try {
      return (await this.prisma.staffInvitation.findUnique({ where: { id } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, invitationId: id },
        'Exception occurred in StaffInvitationRepository.findById',
      );
      return null;
    }
  }

  /** The open invitation for an address, if there is one. */
  async findOpenForEmail(email: string): Promise<InvitationResult> {
    try {
      return (
        (await this.prisma.staffInvitation.findFirst({
          where: { email, status: StaffInvitationStatus.PENDING },
          orderBy: { createdAt: 'desc' },
        })) ?? undefined
      );
    } catch (error) {
      this.logger.error(
        { err: error, email },
        'Exception occurred in StaffInvitationRepository.findOpenForEmail',
      );
      return null;
    }
  }

  async findPage(
    where: Prisma.StaffInvitationWhereInput,
    skip: number,
    take: number,
  ): Promise<InvitationPage | null> {
    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.staffInvitation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.staffInvitation.count({ where }),
      ]);

      return { items, total };
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in StaffInvitationRepository.findPage');
      return null;
    }
  }
}

/** Thrown inside the transaction to roll it back when a race lost. Never leaves this file. */
class InvitationNoLongerPendingError extends Error {}
