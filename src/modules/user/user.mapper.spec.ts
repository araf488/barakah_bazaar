import { addressFixture } from '../../../test/support/user-fixtures';
import { UserMapper } from './user.mapper';

describe('UserMapper', () => {
  describe('toAddress', () => {
    it('round-trips every field of the contract', () => {
      expect(UserMapper.toAddress(addressFixture())).toEqual({
        id: 'address-1',
        label: 'Home',
        recipientName: 'Rahim Uddin',
        phone: '+8801712345678',
        division: 'Dhaka',
        district: 'Dhaka',
        unit: 'Savar',
        area: 'Birulia',
        addressLine: 'House 12, Road 4',
        postCode: '1344',
        latitude: null,
        longitude: null,
        isDefault: true,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      });
    });

    it('surfaces the upazila column as unit, matching the geo endpoints', () => {
      const dto = UserMapper.toAddress(addressFixture({ upazila: 'Gulshan' }));

      expect(dto.unit).toBe('Gulshan');
      expect(dto).not.toHaveProperty('upazila');
    });

    it('never exposes the soft-delete column or the owner id', () => {
      const dto = UserMapper.toAddress(addressFixture({ deletedAt: new Date() }));

      expect(dto).not.toHaveProperty('deletedAt');
      expect(dto).not.toHaveProperty('userId');
    });

    it('exposes map-pin coordinates when they were captured', () => {
      const dto = UserMapper.toAddress(addressFixture({ latitude: 23.7925, longitude: 90.4078 }));

      expect(dto.latitude).toBeCloseTo(23.7925, 4);
      expect(dto.longitude).toBeCloseTo(90.4078, 4);
    });

    it('passes nullable fields through as null rather than dropping them', () => {
      const dto = UserMapper.toAddress(addressFixture({ label: null, area: null, postCode: null }));

      expect(dto.label).toBeNull();
      expect(dto.area).toBeNull();
      expect(dto.postCode).toBeNull();
    });
  });

  describe('toAddressList', () => {
    it('maps every row and preserves the order it was given', () => {
      const list = UserMapper.toAddressList([
        addressFixture({ id: 'address-1' }),
        addressFixture({ id: 'address-2', isDefault: false }),
      ]);

      expect(list.map((address) => address.id)).toEqual(['address-1', 'address-2']);
    });

    it('maps an empty list to an empty list', () => {
      expect(UserMapper.toAddressList([])).toEqual([]);
    });
  });
});
