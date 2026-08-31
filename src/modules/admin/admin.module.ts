import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminCatalogRepository } from './admin-catalog.repository';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminImageService } from './admin-image.service';
import { AdminImportService } from './admin-import.service';
import { AdminUserController } from './admin-user.controller';
import { AdminUserRepository } from './admin-user.repository';
import { AdminUserService } from './admin-user.service';
import { AdminController } from './admin.controller';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';
import { NoopEmailSender } from '../notification/gateways/noop-email.sender';
import { AdminTokens } from './admin.constants';
import {
  StaffInvitationAcceptController,
  StaffInvitationController,
} from './staff-invitation.controller';
import { StaffInvitationRepository } from './staff-invitation.repository';
import { StaffInvitationService } from './staff-invitation.service';

/**
 * Backoffice: the audit trail, catalog write-side, account management and staff invitations.
 *
 * Exports AuditLogService because every module that performs a staff write appends to the
 * same trail — a second log would defeat the point of having one.
 *
 * The email sender is bound here rather than imported from NotificationModule, matching how
 * that module binds its own SMS gateway: invitations and order updates are different
 * audiences, and a deployment may well want a different from-address for each.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    AdminController,
    AdminCatalogController,
    AdminUserController,
    StaffInvitationController,
    StaffInvitationAcceptController,
  ],
  providers: [
    AuditLogService,
    AuditLogRepository,
    AdminCatalogService,
    AdminCatalogRepository,
    AdminImportService,
    AdminImageService,
    AdminUserService,
    AdminUserRepository,
    StaffInvitationService,
    StaffInvitationRepository,
    { provide: AdminTokens.EmailSender, useClass: NoopEmailSender },
  ],
  exports: [AuditLogService, AuditLogRepository, AdminCatalogRepository],
})
export class AdminModule {}
