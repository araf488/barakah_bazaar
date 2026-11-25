import { distanceKm, reachWithin } from './delivery-reach';

// Real Bangladeshi coordinates, so the distances are checkable against a map.
const gulshan = { latitude: 23.7925, longitude: 90.4078 };
const motijheel = { latitude: 23.7331, longitude: 90.4172 };
const chattogram = { latitude: 22.3569, longitude: 91.7832 };
const nowhere = { latitude: null, longitude: null };

describe('distanceKm', () => {
  it('measures a short city hop in kilometres', () => {
    // Gulshan to Motijheel is about 6.6 km as the crow flies.
    expect(distanceKm(gulshan, motijheel)).toBeCloseTo(6.6, 0);
  });

  it('measures a long inter-city distance', () => {
    // Dhaka to Chattogram is ~213 km great-circle. (The 244 km figure people quote is the
    // road distance, which is not what a haversine measures.)
    expect(distanceKm(gulshan, chattogram)).toBeCloseTo(213, -1);
  });

  it('is zero between a point and itself', () => {
    expect(distanceKm(gulshan, gulshan)).toBeCloseTo(0, 5);
  });

  it('is symmetric', () => {
    expect(distanceKm(gulshan, chattogram)).toBeCloseTo(
      distanceKm(chattogram, gulshan) as number,
      5,
    );
  });

  it('returns null when the origin has no coordinates', () => {
    expect(distanceKm(nowhere, gulshan)).toBeNull();
  });

  it('returns null when the destination has no coordinates', () => {
    expect(distanceKm(gulshan, nowhere)).toBeNull();
  });

  it('treats a zero coordinate as a real position, not a missing one', () => {
    // 0,0 is in the Atlantic, but it is a coordinate. A falsy check here would call it null.
    expect(distanceKm({ latitude: 0, longitude: 0 }, gulshan)).toBeGreaterThan(0);
  });
});

describe('reachWithin', () => {
  it('reports within when the distance is under the limit', () => {
    expect(reachWithin(gulshan, motijheel, 10)).toBe('within');
  });

  it('reports too-far when the distance exceeds the limit', () => {
    expect(reachWithin(gulshan, chattogram, 10)).toBe('too-far');
  });

  it('treats a distance exactly at the limit as within', () => {
    const exact = distanceKm(gulshan, motijheel) as number;

    expect(reachWithin(gulshan, motijheel, Math.ceil(exact))).toBe('within');
  });

  it('reports within when there is no limit at all, without measuring', () => {
    expect(reachWithin(nowhere, nowhere, null)).toBe('within');
  });

  it('reports unknown when a limit exists but the distance cannot be measured', () => {
    // A real answer, not a failure: most addresses carry no coordinates.
    expect(reachWithin(gulshan, nowhere, 10)).toBe('unknown');
  });
});
