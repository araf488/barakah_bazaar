import { HttpStatus } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../test/support/mocks';
import { DeliveryRepository } from './delivery.repository';
import { DeliveryService } from './delivery.service';

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
  let repository: { findCandidates: jest.Mock };
  let logger: jest.Mocked<PinoLogger>;
  let service: DeliveryService;

  beforeEach(() => {
    repository = { findCandidates: jest.fn() };
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
