import { AdminAuditLog, UserRole } from '../../src/infra/prisma/prisma-client';

export const auditEntryFixture = (overrides: Partial<AdminAuditLog> = {}): AdminAuditLog => ({
  id: 'audit-1',
  actorId: 'user-1',
  actorEmail: 'ops@barakahbazaar.com.bd',
  actorRole: UserRole.SUPER_ADMIN,
  action: 'product.published',
  entityType: 'Product',
  entityId: 'product-1',
  before: null,
  after: null,
  requestId: 'trace-1',
  createdAt: new Date('2026-08-30T00:00:00.000Z'),
  ...overrides,
});
