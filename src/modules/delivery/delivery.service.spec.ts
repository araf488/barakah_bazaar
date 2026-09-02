import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../test/support/mocks';
import { DeliveryRepository } from './delivery.repository';
import { DeliveryService } from './delivery.service';
import { occurrenceKey, startOfDay } from './slot-availability';

const zone = (nameEn: string, feePoysha: bigint, freeAbovePoysha: bigint | null = null) => ({
  id: `zone-${nameEn}`,
  nameEn,
  nameBn: null,
  feePoysha,
  freeAbovePoysha,
  isDefault: false,
  isActive: true,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const rule = (
  division: string,
  district: string | null,
  unit: string | null,
  z: ReturnType<typeof zone>,
) => ({
  id: `rule-${division}-${district}-${unit}`,
  zoneId: z.id,
  division,
  district,
  unit,
  createdAt: new Date(),
  zone: z,
});

const dhaka = { division: 'Dhaka', district: 'Dhaka', unit: 'Gulshan' };

describe('DeliveryService', () => {
  let repository: Record<string, jest.Mock>;
  let logger: jest.Mocked<PinoLogger>;
  let service: DeliveryService;

  beforeEach(() => {
    repository = {
      findCandidates: jest.fn(),
      findSlotsForWarehouse: jest.fn(),
      countBookings: jest.fn(),
      findSlotById: jest.fn(),
    };
    logger = createMockLogger();
    service = new DeliveryService(repository as unknown as DeliveryRepository, logger);
  });

  describe('specificity', () => {
    it('prefers a unit rule over the district rule that also matches', async () => {
      const divisionZone = zone('Division', 12000n);
      const districtZone = zone('District', 8000n);
      const unitZone = zone('Unit', 6000n);

      repository.findCandidates.mockResolvedValue({
        rules: [
          rule('Dhaka', null, null, divisionZone),
          rule('Dhaka', 'Dhaka', null, districtZone),
          rule('Dhaka', 'Dhaka', 'Gulshan', unitZone),
        ],
        fallback: null,
      });

      const result = await service.resolveFee(dhaka, 100000n);

      expect(result.ok && result.data.feePoysha).toBe(6000n);
      expect(result.ok && result.data.zone.nameEn).toBe('Unit');
    });

    it('prefers a district rule over the division rule', async () => {
      repository.findCandidates.mockResolvedValue({
        rules: [
          rule('Dhaka', null, null, zone('Division', 12000n)),
          rule('Dhaka', 'Dhaka', null, zone('District', 8000n)),
        ],
        fallback: null,
      });

      const result = await service.resolveFee(dhaka, 100000n);

      expect(result.ok && result.data.feePoysha).toBe(8000n);
    });

    it('does not depend on the order the rules came back in', async () => {
      const rules = [
        rule('Dhaka', 'Dhaka', 'Gulshan', zone('Unit', 6000n)),
        rule('Dhaka', null, null, zone('Division', 12000n)),
      ];

      repository.findCandidates.mockResolvedValue({ rules, fallback: null });
      const forwards = await service.resolveFee(dhaka, 100000n);

      repository.findCandidates.mockResolvedValue({ rules: [...rules].reverse(), fallback: null });
      const backwards = await service.resolveFee(dhaka, 100000n);

      expect(forwards.ok && forwards.data.feePoysha).toBe(6000n);
      expect(backwards.ok && backwards.data.feePoysha).toBe(6000n);
    });

    it('falls back to the default zone when no rule matches', async () => {
      repository.findCandidates.mockResolvedValue({
        rules: [],
        fallback: zone('Rest of Bangladesh', 15000n),
      });

      const result = await service.resolveFee(dhaka, 100000n);

      expect(result.ok && result.data.feePoysha).toBe(15000n);
    });

    it('prefers any matching rule over the default zone', async () => {
      repository.findCandidates.mockResolvedValue({
        rules: [rule('Dhaka', null, null, zone('Division', 12000n))],
        fallback: zone('Rest of Bangladesh', 15000n),
      });

      const result = await service.resolveFee(dhaka, 100000n);

      expect(result.ok && result.data.feePoysha).toBe(12000n);
    });
  });

  describe('free delivery threshold', () => {
    it('waives the fee once the basket reaches the threshold', async () => {
      repository.findCandidates.mockResolvedValue({
        rules: [rule('Dhaka', null, null, zone('Dhaka', 6000n, 200000n))],
        fallback: null,
      });

      const result = await service.resolveFee(dhaka, 200000n);

      expect(result.ok && result.data.feePoysha).toBe(0n);
      expect(result.ok && result.data.isFree).toBe(true);
    });

    it('charges when the basket is one poysha short', async () => {
      repository.findCandidates.mockResolvedValue({
        rules: [rule('Dhaka', null, null, zone('Dhaka', 6000n, 200000n))],
        fallback: null,
      });

      const result = await service.resolveFee(dhaka, 199999n);

      expect(result.ok && result.data.feePoysha).toBe(6000n);
      expect(result.ok && result.data.isFree).toBe(false);
    });

    it('never waives in a zone with no threshold, however large the basket', async () => {
      repository.findCandidates.mockResolvedValue({
        rules: [rule('Dhaka', null, null, zone('Dhaka', 6000n, null))],
        fallback: null,
      });

      const result = await service.resolveFee(dhaka, 99999999n);

      expect(result.ok && result.data.feePoysha).toBe(6000n);
    });

    it('reports a zero-fee zone as free', async () => {
      repository.findCandidates.mockResolvedValue({
        rules: [rule('Dhaka', null, null, zone('Free zone', 0n))],
        fallback: null,
      });

      const result = await service.resolveFee(dhaka, 1n);

      expect(result.ok && result.data.isFree).toBe(true);
    });
  });

  describe('when pricing is not configured', () => {
    it('refuses rather than shipping free', async () => {
      // A silent zero is a revenue leak nobody notices; a refusal is loud and gets fixed.
      repository.findCandidates.mockResolvedValue({ rules: [], fallback: null });

      const result = await service.resolveFee(dhaka, 100000n);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: 'Delivery is not available to that address yet. Please contact support.',
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it('reports 503 when the zones cannot be read', async () => {
      repository.findCandidates.mockResolvedValue(null);

      const result = await service.resolveFee(dhaka, 100000n);

      expect(result.ok === false && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('quote', () => {
    it('tells the customer how much more they need for free delivery', async () => {
      repository.findCandidates.mockResolvedValue({
        rules: [rule('Dhaka', null, null, zone('Inside Dhaka', 6000n, 200000n))],
        fallback: null,
      });

      const result = await service.quote(dhaka, 150000n);

      expect(result.ok && result.data).toEqual({
        feePoysha: 6000,
        zoneNameEn: 'Inside Dhaka',
        zoneNameBn: null,
        isFree: false,
        freeDeliveryShortfallPoysha: 50000,
      });
    });

    it('reports no shortfall once free delivery is earned', async () => {
      repository.findCandidates.mockResolvedValue({
        rules: [rule('Dhaka', null, null, zone('Inside Dhaka', 6000n, 200000n))],
        fallback: null,
      });

      const result = await service.quote(dhaka, 250000n);

      expect(result.ok && result.data.freeDeliveryShortfallPoysha).toBeNull();
      expect(result.ok && result.data.isFree).toBe(true);
    });

    it('reports no shortfall where free delivery is not offered at all', async () => {
      repository.findCandidates.mockResolvedValue({
        rules: [rule('Dhaka', null, null, zone('Inside Dhaka', 6000n, null))],
        fallback: null,
      });

      const result = await service.quote(dhaka, 250000n);

      expect(result.ok && result.data.freeDeliveryShortfallPoysha).toBeNull();
    });

    it('passes a pricing failure through rather than quoting zero', async () => {
      repository.findCandidates.mockResolvedValue({ rules: [], fallback: null });

      const result = await service.quote(dhaka, 100000n);

      expect(result.ok).toBe(false);
    });
  });
});

describe('DeliveryService slots', () => {
  let repository: Record<string, jest.Mock>;
  let logger: jest.Mocked<PinoLogger>;
  let service: DeliveryService;

  /** Midday today, so "later the same day" stays on today's date. */
  const noon = (): Date => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    return date;
  };

  /** A window that opens two hours from now, on every weekday. */
  const openWindow = (overrides = {}) => {
    const start = new Date();
    const startMinute = start.getHours() * 60 + start.getMinutes() + 120;

    return {
      id: 'slot-1',
      warehouseId: 'wh-1',
      startMinute,
      endMinute: startMinute + 60,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      capacity: 20,
      cutoffMinutes: 0,
      supportsPerishable: true,
      isActive: true,
      ...overrides,
    };
  };

  beforeEach(() => {
    repository = {
      findCandidates: jest.fn(),
      findSlotsForWarehouse: jest.fn().mockResolvedValue([openWindow()]),
      countBookings: jest.fn().mockResolvedValue(new Map()),
      findSlotById: jest.fn().mockResolvedValue(openWindow()),
    };
    logger = createMockLogger();
    service = new DeliveryService(repository as unknown as DeliveryRepository, logger);
  });

  describe('listSlots', () => {
    it('asks only for the hub that will pack the order', async () => {
      await service.listSlots('wh-1', false, 7);

      expect(repository.findSlotsForWarehouse).toHaveBeenCalledWith('wh-1');
    });

    it('counts bookings from today to the end of the horizon', async () => {
      await service.listSlots('wh-1', false, 3);

      const [ids, from, to] = repository.countBookings.mock.calls[0] as [string[], Date, Date];

      expect(ids).toEqual(['slot-1']);
      expect(from.getHours()).toBe(0);
      expect(Math.round((to.getTime() - from.getTime()) / 86_400_000)).toBe(3);
    });

    it('reports 503 rather than an empty list when the windows cannot be read', async () => {
      // An empty list would read as "no windows today" and quietly stop the shop selling.
      repository.findSlotsForWarehouse.mockResolvedValue(null);

      const result = await service.listSlots('wh-1', false, 7);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Could not load delivery pricing. Please try again.',
      });
    });

    it('reports 503 when the bookings cannot be counted', async () => {
      repository.countBookings.mockResolvedValue(null);

      const result = await service.listSlots('wh-1', false, 7);

      expect(result.ok === false && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('subtracts the places already taken', async () => {
      repository.countBookings.mockResolvedValue(
        new Map([[occurrenceKey('slot-1', startOfDay(new Date())), 18]]),
      );

      const result = await service.listSlots('wh-1', false, 1);

      expect(result.ok && result.data[0].remaining).toBe(2);
    });

    it('offers no ambient window to a basket that needs cold', async () => {
      repository.findSlotsForWarehouse.mockResolvedValue([
        openWindow({ supportsPerishable: false }),
      ]);

      const result = await service.listSlots('wh-1', true, 1);

      expect(result.ok && result.data).toEqual([]);
    });

    it('reports 500 when the repository throws outright', async () => {
      repository.findSlotsForWarehouse.mockRejectedValue(new Error('boom'));

      const result = await service.listSlots('wh-1', false, 7);

      expect(result.ok === false && result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('assertSlotBookable', () => {
    it('accepts a window that is still open on the chosen date', async () => {
      expect(await service.assertSlotBookable('slot-1', noon(), 'wh-1', false)).toEqual({
        ok: true,
        data: undefined,
      });
    });

    it('refuses a window that belongs to another hub', async () => {
      // No capacity count would catch this: the count would be right, and the van would be
      // in the wrong city.
      const result = await service.assertSlotBookable('slot-1', noon(), 'wh-2', false);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'That delivery slot is not offered for this order.',
      });
    });

    it('refuses an ambient van for a perishable basket', async () => {
      repository.findSlotById.mockResolvedValue(openWindow({ supportsPerishable: false }));

      const result = await service.assertSlotBookable('slot-1', noon(), 'wh-1', true);

      expect(result.ok === false && result.status).toBe(HttpStatus.CONFLICT);
    });

    it('refuses a window that has been switched off', async () => {
      repository.findSlotById.mockResolvedValue(openWindow({ isActive: false }));

      const result = await service.assertSlotBookable('slot-1', noon(), 'wh-1', false);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'That delivery slot is no longer available. Please choose another.',
      });
    });

    it('refuses a window that no longer exists', async () => {
      repository.findSlotById.mockResolvedValue(undefined);

      const result = await service.assertSlotBookable('slot-1', noon(), 'wh-1', false);

      expect(result.ok === false && result.status).toBe(HttpStatus.CONFLICT);
    });

    it('reports 503 when the window cannot be read, rather than refusing the order', async () => {
      repository.findSlotById.mockResolvedValue(null);

      const result = await service.assertSlotBookable('slot-1', noon(), 'wh-1', false);

      expect(result.ok === false && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('refuses a date the window does not run on', async () => {
      const wrongDay = new Date();
      wrongDay.setDate(wrongDay.getDate() + 1);
      repository.findSlotsForWarehouse.mockResolvedValue([
        openWindow({ daysOfWeek: [new Date().getDay()] }),
      ]);

      const result = await service.assertSlotBookable('slot-1', wrongDay, 'wh-1', false);

      expect(result.ok === false && result.status).toBe(HttpStatus.CONFLICT);
    });

    it('refuses a window whose last place went between browsing and paying', async () => {
      // This is the check that counts: availability was computed when the page opened.
      repository.countBookings.mockResolvedValue(
        new Map([[occurrenceKey('slot-1', startOfDay(new Date())), 20]]),
      );

      const result = await service.assertSlotBookable('slot-1', noon(), 'wh-1', false);

      expect(result).toEqual({
        ok: false,
        status: HttpStatus.CONFLICT,
        message: 'That delivery slot is no longer available. Please choose another.',
      });
    });

    it('passes a read failure through rather than calling the window unavailable', async () => {
      repository.countBookings.mockResolvedValue(null);

      const result = await service.assertSlotBookable('slot-1', noon(), 'wh-1', false);

      expect(result.ok === false && result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });
});
