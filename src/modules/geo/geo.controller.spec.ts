import { HttpException, HttpStatus } from '@nestjs/common';
import { createMockLogger } from '../../../test/support/mocks';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';

describe('GeoController', () => {
  let geoService: {
    listDivisions: jest.Mock;
    listDistricts: jest.Mock;
    listUnits: jest.Mock;
    listAreas: jest.Mock;
  };
  let controller: GeoController;

  beforeEach(() => {
    geoService = {
      listDivisions: jest.fn(),
      listDistricts: jest.fn(),
      listUnits: jest.fn(),
      listAreas: jest.fn(),
    };
    controller = new GeoController(geoService as unknown as GeoService, createMockLogger());
  });

  describe('listDivisions', () => {
    it('returns the divisions on success', () => {
      const divisions = [{ nameEn: 'Dhaka', nameBn: 'ঢাকা', districtCount: 13 }];
      geoService.listDivisions.mockReturnValue({ ok: true, data: divisions });

      expect(controller.listDivisions()).toEqual(divisions);
    });

    it('translates a service failure into an HTTP error', () => {
      geoService.listDivisions.mockReturnValue({
        ok: false,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Something went wrong on our end. Please try again.',
      });

      expect(() => controller.listDivisions()).toThrow(HttpException);
    });
  });

  describe('listDistricts', () => {
    it('passes the division through', () => {
      geoService.listDistricts.mockReturnValue({ ok: true, data: [] });

      controller.listDistricts('Sylhet');

      expect(geoService.listDistricts).toHaveBeenCalledWith('Sylhet');
    });

    it('answers 404 with the message the contract specifies', () => {
      geoService.listDistricts.mockReturnValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Narnia is not a division of Bangladesh.',
      });

      expect(() => controller.listDistricts('Narnia')).toThrow(
        'Narnia is not a division of Bangladesh.',
      );
    });
  });

  describe('listUnits', () => {
    it('returns the units on success', () => {
      const units = [
        { nameEn: 'Gulshan', nameBn: null, kind: 'thana', districtEn: 'Dhaka', areaCount: 2 },
      ];
      geoService.listUnits.mockReturnValue({ ok: true, data: units });

      expect(controller.listUnits('Dhaka')).toEqual(units);
    });

    it('answers 404 for an unknown district', () => {
      geoService.listUnits.mockReturnValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Gotham is not a district of Bangladesh.',
      });

      expect(() => controller.listUnits('Gotham')).toThrow(HttpException);
    });
  });

  describe('listAreas', () => {
    it('passes both path segments through, in order', () => {
      geoService.listAreas.mockReturnValue({ ok: true, data: { areas: [] } });

      controller.listAreas('Dhaka', 'Savar');

      expect(geoService.listAreas).toHaveBeenCalledWith('Dhaka', 'Savar');
    });

    it('returns the area list on success', () => {
      const payload = {
        divisionEn: 'Dhaka',
        districtEn: 'Dhaka',
        unitEn: 'Savar',
        areas: [{ nameEn: 'Birulia', nameBn: 'বিরুলিয়া', kind: 'union' }],
      };
      geoService.listAreas.mockReturnValue({ ok: true, data: payload });

      expect(controller.listAreas('Dhaka', 'Savar')).toEqual(payload);
    });

    it('answers 404 for a unit that is not in the district', () => {
      geoService.listAreas.mockReturnValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        message: 'Nonesuch is not an upazila or thana of Dhaka.',
      });

      expect(() => controller.listAreas('Dhaka', 'Nonesuch')).toThrow(
        'Nonesuch is not an upazila or thana of Dhaka.',
      );
    });
  });
});
