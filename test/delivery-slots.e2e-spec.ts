import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ErrorMessages } from '../src/common/constants/error-messages.constants';
import { ErrorResponseBody } from '../src/common/filters/global-exception.filter';
import { UserRole } from '../src/infra/prisma/prisma-client';
import { AuthConstants } from '../src/modules/auth/auth.constants';
import {
  AccessTokenClaims,
  AccessTokenService,
} from '../src/modules/auth/tokens/access-token.service';
import { SessionService, ValidatedSession } from '../src/modules/auth/sessions/session.service';
import { ServiceResponse } from '../src/common/types/service-response';
import { userFixture } from './support/user-fixtures';

// ConfigModule.forRoot() reads and validates the environment at the moment app.module.ts is
// imported, not when the module is instantiated — so this has to be at module scope, before a
// dynamic import of AppModule inside beforeAll. See degraded-boot.e2e-spec.ts.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'false';
process.env.QUEUE_ENABLED = 'false';
process.env.GEOCODING_PROVIDER = 'noop';
// This suite makes far more than a handful of requests to one endpoint, so it states the
// limits it needs rather than inheriting whatever a suite earlier in the same jest worker
// left in process.env. See rate-limiting.e2e-spec.ts, which deliberately sets tiny ones.
process.env.AUTH_RATE_LIMIT = '1000';
process.env.WRITE_RATE_LIMIT = '1000';
process.env.GEOCODING_RATE_LIMIT = '1000';
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const CUSTOMER_ADDRESS = '3f7c1b2e-9a4d-4c11-8f6e-2b5a7d9c0e13';
const SLOT_ID = '8c2d5a91-4e63-4f70-9b18-6a0d3c7e5f42';
const WAREHOUSE_ID = 'a1f4c0de-2b73-4f9a-9c1e-8d5b6a0f3e21';

const ORDER_SLOTS = '/api/v1/orders/delivery-slots';
const ADMIN_SLOTS = '/api/v1/admin/delivery/zones/slots';

/** A token this suite's stub token service rejects, standing in for an expired or forged one. */
const REJECTED_TOKEN = 'not-a-real-token';

/** Every authenticated request in this suite identifies as the same device. */
const DEVICE_ID = 'device-1';

/**
 * Stands in for this application's own session stack, so role enforcement can be exercised
 * with no database.
 *
 * The token is the role name, and stage one (AccessTokenService.verify) accepts it only when
 * a device id is also present — exactly SessionAuthGuard's real contract. Stage two
 * (SessionService.validate) always succeeds for a token stage one accepted: this suite has
 * nothing to say about revocation or expiry, which the guard's own unit spec already proves.
 * SessionAuthGuard, RolesGuard, the routing table, the global ValidationPipe and the exception
 * filter all run for real, which is the point of this file: the service specs already prove
 * the rules, and what stays unproven there is that a request reaches the right handler with
 * the right protection.
 */
const stubTokens = {
  verify: (
    token: string,
    deviceId: string | undefined,
    expected: string,
  ): Promise<AccessTokenClaims | null> =>
    Promise.resolve(
      deviceId && expected === 'access' && Object.values(UserRole).includes(token as UserRole)
        ? {
            userId: 'staff-1',
            sessionId: 'session-1',
            role: token as UserRole,
            email: 'staff@example.com',
            type: 'access' as const,
          }
        : null,
    ),
};

const stubSessions = {
  validate: (claims: AccessTokenClaims): Promise<ServiceResponse<ValidatedSession>> =>
    Promise.resolve({
      ok: true,
      data: {
        user: userFixture({ id: claims.userId, email: claims.email, role: claims.role }),
        sessionId: claims.sessionId,
      },
    }),
};

const slotRow = () => ({
  id: SLOT_ID,
  warehouseId: WAREHOUSE_ID,
  labelEn: 'Morning 9-11',
  labelBn: null,
  startMinute: 540,
  endMinute: 660,
  daysOfWeek: [0, 1, 2],
  capacity: 20,
  cutoffMinutes: 120,
  supportsPerishable: true,
  isActive: true,
  sortOrder: 0,
});

const validSlotBody = (overrides: Record<string, unknown> = {}) => ({
  warehouseId: WAREHOUSE_ID,
  labelEn: 'Morning 9-11',
  startMinute: 540,
  endMinute: 660,
  daysOfWeek: [0, 1, 2],
  capacity: 20,
  cutoffMinutes: 120,
  supportsPerishable: true,
  ...overrides,
});

/**
 * The delivery-slot endpoints, through the real request pipeline.
 *
 * Routing, guards, the global ValidationPipe and the error contract are exercised end to end;
 * the two services behind them are stubbed, so what is asserted here is the HTTP contract
 * rather than a second copy of the availability rules.
 */
describe('Delivery slots (HTTP)', () => {
  let app: INestApplication;
  let orderService: { listDeliverySlots: jest.Mock; getMyOrder: jest.Mock };
  let adminDelivery: { listSlots: jest.Mock; createSlot: jest.Mock; updateSlot: jest.Mock };

  const get = (path: string, role?: UserRole) => {
    const call = request(app.getHttpServer()).get(path);
    return role
      ? call.set('Authorization', `Bearer ${role}`).set(AuthConstants.DeviceIdHeader, DEVICE_ID)
      : call;
  };

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module');
    const { OrderService } = await import('../src/modules/order/order.service');
    const { AdminDeliveryService } = await import('../src/modules/delivery/admin-delivery.service');

    orderService = { listDeliverySlots: jest.fn(), getMyOrder: jest.fn() };
    adminDelivery = { listSlots: jest.fn(), createSlot: jest.fn(), updateSlot: jest.fn() };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AccessTokenService)
      .useValue(stubTokens)
      .overrideProvider(SessionService)
      .useValue(stubSessions)
      .overrideProvider(OrderService)
      .useValue(orderService)
      .overrideProvider(AdminDeliveryService)
      .useValue(adminDelivery)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    orderService.listDeliverySlots.mockResolvedValue({ ok: true, data: [] });
    orderService.getMyOrder.mockResolvedValue({ ok: true, data: {} });
    adminDelivery.listSlots.mockResolvedValue({ ok: true, data: [slotRow()] });
    adminDelivery.createSlot.mockResolvedValue({ ok: true, data: slotRow() });
    adminDelivery.updateSlot.mockResolvedValue({ ok: true, data: slotRow() });
  });

  describe('the customer route is reachable at all', () => {
    it('serves GET /orders/delivery-slots rather than the :id route', async () => {
      // Declared after ':id' this would hit the uuid route and 400 on ParseUUIDPipe — a dead
      // endpoint that every mock-based test would still pass over.
      const response = await get(`${ORDER_SLOTS}?addressId=${CUSTOMER_ADDRESS}`, UserRole.CUSTOMER);

      expect(response.status).toBe(HttpStatus.OK);
      expect(orderService.listDeliverySlots).toHaveBeenCalledTimes(1);
      expect(orderService.getMyOrder).not.toHaveBeenCalled();
    });

    it('asks for the caller, the address and the default horizon', async () => {
      await get(`${ORDER_SLOTS}?addressId=${CUSTOMER_ADDRESS}`, UserRole.CUSTOMER);

      expect(orderService.listDeliverySlots).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.CUSTOMER }),
        CUSTOMER_ADDRESS,
        7,
      );
    });

    it('honours an explicit horizon', async () => {
      await get(`${ORDER_SLOTS}?addressId=${CUSTOMER_ADDRESS}&days=3`, UserRole.CUSTOMER);

      expect(orderService.listDeliverySlots.mock.calls[0][2]).toBe(3);
    });
  });

  describe('what the customer gets back', () => {
    it('renders the delivery date as a local calendar day, not a UTC instant', async () => {
      // new Date(2026, 0, 5) is midnight local. toISOString would render 2026-01-04 anywhere
      // east of Greenwich — the day before the van arrives.
      orderService.listDeliverySlots.mockResolvedValue({
        ok: true,
        data: [
          {
            slotId: SLOT_ID,
            date: new Date(2026, 0, 5),
            startMinute: 540,
            endMinute: 660,
            remaining: 4,
            supportsPerishable: true,
          },
        ],
      });

      const response = await get(`${ORDER_SLOTS}?addressId=${CUSTOMER_ADDRESS}`, UserRole.CUSTOMER);

      expect(response.body).toEqual([
        {
          slotId: SLOT_ID,
          date: '2026-01-05',
          startMinute: 540,
          endMinute: 660,
          remaining: 4,
          supportsPerishable: true,
        },
      ]);
    });

    it('refuses with the reason when no hub can serve the basket to that address', async () => {
      // An empty list reads as "no windows today". Unreachable is a different problem.
      orderService.listDeliverySlots.mockResolvedValue({
        ok: false,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: 'Delivery is not available to that address yet. Please contact support.',
      });

      const response = await get(`${ORDER_SLOTS}?addressId=${CUSTOMER_ADDRESS}`, UserRole.CUSTOMER);

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(response.body.message).toBe(
        'Delivery is not available to that address yet. Please contact support.',
      );
      expect(Array.isArray(response.body)).toBe(false);
    });

    it('passes a deleted address through as 404', async () => {
      orderService.listDeliverySlots.mockResolvedValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'That delivery address is no longer available.',
      });

      const response = await get(`${ORDER_SLOTS}?addressId=${CUSTOMER_ADDRESS}`, UserRole.CUSTOMER);

      expect(response.status).toBe(HttpStatus.NOT_FOUND);
      expect(response.body.message).toBe('That delivery address is no longer available.');
    });
  });

  describe('the customer route validates its query', () => {
    it('rejects a missing address', async () => {
      const response = await get(ORDER_SLOTS, UserRole.CUSTOMER);

      const errors = (response.body as ErrorResponseBody).errors ?? [];

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.message).toBe(ErrorMessages.ValidationFailed);
      expect(errors.join(' ')).toContain('addressId');
      expect(orderService.listDeliverySlots).not.toHaveBeenCalled();
    });

    it('rejects an address that is not a uuid', async () => {
      const response = await get(`${ORDER_SLOTS}?addressId=not-a-uuid`, UserRole.CUSTOMER);

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(orderService.listDeliverySlots).not.toHaveBeenCalled();
    });

    it('rejects a horizon of zero days', async () => {
      const response = await get(
        `${ORDER_SLOTS}?addressId=${CUSTOMER_ADDRESS}&days=0`,
        UserRole.CUSTOMER,
      );

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('rejects a horizon beyond the 14-day maximum', async () => {
      const response = await get(
        `${ORDER_SLOTS}?addressId=${CUSTOMER_ADDRESS}&days=15`,
        UserRole.CUSTOMER,
      );

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(orderService.listDeliverySlots).not.toHaveBeenCalled();
    });

    it('accepts the maximum horizon', async () => {
      const response = await get(
        `${ORDER_SLOTS}?addressId=${CUSTOMER_ADDRESS}&days=14`,
        UserRole.CUSTOMER,
      );

      expect(response.status).toBe(HttpStatus.OK);
    });

    it('rejects an unknown query parameter rather than ignoring it', async () => {
      const response = await get(
        `${ORDER_SLOTS}?addressId=${CUSTOMER_ADDRESS}&warehouseId=${WAREHOUSE_ID}`,
        UserRole.CUSTOMER,
      );

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(orderService.listDeliverySlots).not.toHaveBeenCalled();
    });

    it('requires a signed-in caller', async () => {
      const response = await request(app.getHttpServer()).get(
        `${ORDER_SLOTS}?addressId=${CUSTOMER_ADDRESS}`,
      );

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(response.body.message).toBe(ErrorMessages.MissingAccessToken);
      expect(orderService.listDeliverySlots).not.toHaveBeenCalled();
    });

    it('refuses a token that does not verify', async () => {
      const response = await request(app.getHttpServer())
        .get(`${ORDER_SLOTS}?addressId=${CUSTOMER_ADDRESS}`)
        .set('Authorization', `Bearer ${REJECTED_TOKEN}`);

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(orderService.listDeliverySlots).not.toHaveBeenCalled();
    });

    it('refuses an Authorization header that is not a bearer token', async () => {
      const response = await request(app.getHttpServer())
        .get(`${ORDER_SLOTS}?addressId=${CUSTOMER_ADDRESS}`)
        .set('Authorization', UserRole.CUSTOMER);

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(orderService.listDeliverySlots).not.toHaveBeenCalled();
    });
  });

  describe('who may manage windows', () => {
    it.each([UserRole.SUPER_ADMIN, UserRole.OPS])('lets %s list them', async (role) => {
      const response = await get(ADMIN_SLOTS, role);

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body).toEqual([slotRow()]);
    });

    it.each([UserRole.CUSTOMER, UserRole.WAREHOUSE, UserRole.MARKETING])(
      'refuses %s with 403',
      async (role) => {
        const response = await get(ADMIN_SLOTS, role);

        expect(response.status).toBe(HttpStatus.FORBIDDEN);
        expect(response.body.message).toBe(ErrorMessages.InsufficientPermission);
        expect(adminDelivery.listSlots).not.toHaveBeenCalled();
      },
    );

    it('refuses an unauthenticated list with 401', async () => {
      const response = await request(app.getHttpServer()).get(ADMIN_SLOTS);

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(adminDelivery.listSlots).not.toHaveBeenCalled();
    });

    it('refuses a forged token with 401 rather than 403', async () => {
      // The order matters: an unverifiable token is not a permission problem, and answering
      // 403 would tell a caller their token was accepted.
      const response = await request(app.getHttpServer())
        .get(ADMIN_SLOTS)
        .set('Authorization', `Bearer ${REJECTED_TOKEN}`);

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(adminDelivery.listSlots).not.toHaveBeenCalled();
    });

    it('refuses an unauthenticated create with 401', async () => {
      const response = await request(app.getHttpServer()).post(ADMIN_SLOTS).send(validSlotBody());

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(adminDelivery.createSlot).not.toHaveBeenCalled();
    });

    it('refuses a create by a customer with 403', async () => {
      const response = await request(app.getHttpServer())
        .post(ADMIN_SLOTS)
        .set('Authorization', `Bearer ${UserRole.CUSTOMER}`)
        .set(AuthConstants.DeviceIdHeader, DEVICE_ID)
        .send(validSlotBody());

      expect(response.status).toBe(HttpStatus.FORBIDDEN);
      expect(adminDelivery.createSlot).not.toHaveBeenCalled();
    });

    it('refuses an update by a warehouse operator with 403', async () => {
      const response = await request(app.getHttpServer())
        .patch(`${ADMIN_SLOTS}/${SLOT_ID}`)
        .set('Authorization', `Bearer ${UserRole.WAREHOUSE}`)
        .set(AuthConstants.DeviceIdHeader, DEVICE_ID)
        .send(validSlotBody());

      expect(response.status).toBe(HttpStatus.FORBIDDEN);
      expect(adminDelivery.updateSlot).not.toHaveBeenCalled();
    });
  });

  describe('creating a window', () => {
    it('answers 201 with the saved window and the acting operator', async () => {
      const response = await request(app.getHttpServer())
        .post(ADMIN_SLOTS)
        .set('Authorization', `Bearer ${UserRole.OPS}`)
        .set(AuthConstants.DeviceIdHeader, DEVICE_ID)
        .send(validSlotBody());

      expect(response.status).toBe(HttpStatus.CREATED);
      expect(response.body).toEqual(slotRow());
      expect(adminDelivery.createSlot).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.OPS }),
        expect.objectContaining({ startMinute: 540, capacity: 20 }),
      );
    });

    it('surfaces an inverted window as a 400 naming the problem', async () => {
      adminDelivery.createSlot.mockResolvedValue({
        ok: false,
        status: HttpStatus.BAD_REQUEST,
        message: 'A delivery window must end after it starts.',
      });

      const response = await request(app.getHttpServer())
        .post(ADMIN_SLOTS)
        .set('Authorization', `Bearer ${UserRole.OPS}`)
        .set(AuthConstants.DeviceIdHeader, DEVICE_ID)
        .send(validSlotBody({ startMinute: 660, endMinute: 540 }));

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.message).toBe('A delivery window must end after it starts.');
    });

    it('surfaces an unwritable audit row as a 503', async () => {
      adminDelivery.createSlot.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Could not record this change in the audit trail, so it was not applied.',
      });

      const response = await request(app.getHttpServer())
        .post(ADMIN_SLOTS)
        .set('Authorization', `Bearer ${UserRole.OPS}`)
        .set(AuthConstants.DeviceIdHeader, DEVICE_ID)
        .send(validSlotBody());

      expect(response.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it.each([
      ['no hub', { warehouseId: undefined }],
      ['a hub that is not a uuid', { warehouseId: 'hub-1' }],
      ['no label', { labelEn: undefined }],
      ['a blank label', { labelEn: '   ' }],
      ['no weekdays at all', { daysOfWeek: [] }],
      ['a weekday out of range', { daysOfWeek: [7] }],
      ['a start beyond the end of the day', { startMinute: 1441 }],
      ['a capacity of zero', { capacity: 0 }],
      ['a fractional capacity', { capacity: 1.5 }],
      ['a negative cutoff', { cutoffMinutes: -1 }],
      ['a non-boolean cold flag', { supportsPerishable: 'yes' }],
      ['an unknown field', { hubId: WAREHOUSE_ID }],
    ])('rejects %s with 400', async (_case, overrides) => {
      const response = await request(app.getHttpServer())
        .post(ADMIN_SLOTS)
        .set('Authorization', `Bearer ${UserRole.OPS}`)
        .set(AuthConstants.DeviceIdHeader, DEVICE_ID)
        .send(validSlotBody(overrides));

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.message).toBe(ErrorMessages.ValidationFailed);
      expect(adminDelivery.createSlot).not.toHaveBeenCalled();
    });
  });

  describe('updating a window', () => {
    it('answers 200 with the window it saved', async () => {
      const response = await request(app.getHttpServer())
        .patch(`${ADMIN_SLOTS}/${SLOT_ID}`)
        .set('Authorization', `Bearer ${UserRole.SUPER_ADMIN}`)
        .set(AuthConstants.DeviceIdHeader, DEVICE_ID)
        .send(validSlotBody());

      expect(response.status).toBe(HttpStatus.OK);
      expect(adminDelivery.updateSlot).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.SUPER_ADMIN }),
        SLOT_ID,
        expect.objectContaining({ capacity: 20 }),
      );
    });

    it('rejects an id that is not a uuid before reaching the service', async () => {
      const response = await request(app.getHttpServer())
        .patch(`${ADMIN_SLOTS}/slot-1`)
        .set('Authorization', `Bearer ${UserRole.OPS}`)
        .set(AuthConstants.DeviceIdHeader, DEVICE_ID)
        .send(validSlotBody());

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(adminDelivery.updateSlot).not.toHaveBeenCalled();
    });

    it('validates the body on update too', async () => {
      const response = await request(app.getHttpServer())
        .patch(`${ADMIN_SLOTS}/${SLOT_ID}`)
        .set('Authorization', `Bearer ${UserRole.OPS}`)
        .set(AuthConstants.DeviceIdHeader, DEVICE_ID)
        .send(validSlotBody({ daysOfWeek: [] }));

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(adminDelivery.updateSlot).not.toHaveBeenCalled();
    });
  });
});
