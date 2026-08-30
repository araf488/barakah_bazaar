import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminCatalogRepository } from './admin-catalog.repository';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminImportService } from './admin-import.service';
import { AdminUserController } from './admin-user.controller';
import { AdminUserRepository } from './admin-user.repository';
import { AdminUserService } from './admin-user.service';
import { AdminController } from './admin.controller';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';

/**
 * Backoffice: the audit trail now, catalog and staff management next.
 *
 * Exports AuditLogService because every module that performs a staff write appends to the
 * same trail — a second log would defeat the point of having one.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminController, AdminCatalogController, AdminUserController],
  providers: [
    AuditLogService,
    AuditLogRepository,
    AdminCatalogService,
    AdminCatalogRepository,
    AdminImportService,
    AdminUserService,
    AdminUserRepository,
  ],
  exports: [AuditLogService],
})
export class AdminModule {}
