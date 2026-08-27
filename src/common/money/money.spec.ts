import { Money, POYSHA_PER_TAKA } from './money';

describe('Money', () => {
  describe('POYSHA_PER_TAKA', () => {
    it('is 100', () => {
      expect(POYSHA_PER_TAKA).toBe(100n);
    });
  });

  describe('fromTaka', () => {
    it('converts whole Taka to poysha', () => {
      expect(Money.fromTaka(1250)).toBe(125000n);
    });

    it('converts fractional Taka, rounding to the nearest poysha', () => {
      expect(Money.fromTaka(12.345)).toBe(1235n);
    });

    it('handles the float representation of 0.1 + 0.2 without drift', () => {
      expect(Money.fromTaka(0.1 + 0.2)).toBe(30n);
    });

    it('converts zero', () => {
      expect(Money.fromTaka(0)).toBe(0n);
    });

    it('rejects a non-finite amount', () => {
      expect(() => Money.fromTaka(Number.NaN)).toThrow(TypeError);
      expect(() => Money.fromTaka(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    });
  });

  describe('toTaka', () => {
    it('converts poysha back to Taka', () => {
      expect(Money.toTaka(125050n)).toBe(1250.5);
    });
  });

  describe('multiply', () => {
    it('multiplies a unit price by a quantity', () => {
      expect(Money.multiply(12550n, 3)).toBe(37650n);
    });

    it('returns zero for a zero quantity', () => {
      expect(Money.multiply(12550n, 0)).toBe(0n);
    });

    it('rejects a fractional quantity', () => {
      expect(() => Money.multiply(100n, 1.5)).toThrow(TypeError);
    });

    it('rejects a negative quantity', () => {
      expect(() => Money.multiply(100n, -1)).toThrow(TypeError);
    });
  });

  describe('sum', () => {
    it('sums line totals', () => {
      expect(Money.sum([12550n, 37650n, 5n])).toBe(50205n);
    });

    it('returns zero for an empty cart', () => {
      expect(Money.sum([])).toBe(0n);
    });
  });

  describe('forWeight', () => {
    it('prices half a kilogram at half the per-kilogram rate', () => {
      expect(Money.forWeight(80000n, 500)).toBe(40000n);
    });

    it('prices 250g at a quarter of the per-kilogram rate', () => {
      expect(Money.forWeight(80000n, 250)).toBe(20000n);
    });

    it('prices a full kilogram at the per-kilogram rate', () => {
      expect(Money.forWeight(80000n, 1000)).toBe(80000n);
    });

    it('rounds half up to the nearest poysha', () => {
      // 333 poysha/kg × 5g = 1.665 poysha → 2
      expect(Money.forWeight(333n, 5)).toBe(2n);
    });

    it('returns zero for zero weight', () => {
      expect(Money.forWeight(80000n, 0)).toBe(0n);
    });

    it('rejects a fractional gram weight', () => {
      expect(() => Money.forWeight(80000n, 250.5)).toThrow(TypeError);
    });

    it('rejects a negative weight', () => {
      expect(() => Money.forWeight(80000n, -250)).toThrow(TypeError);
    });
  });

  describe('format', () => {
    it('renders poysha as a Taka amount with two decimals', () => {
      const formatted = Money.format(125050n);
      expect(formatted).toContain('1,250.50');
    });

    it('renders zero', () => {
      expect(Money.format(0n)).toContain('0.00');
    });
  });

  describe('toJsonNumber', () => {
    it('widens poysha to a plain number for JSON', () => {
      expect(Money.toJsonNumber(125050n)).toBe(125050);
    });
  });
});
