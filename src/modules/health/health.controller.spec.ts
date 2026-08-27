import { HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { createMockLogger } from '../../../test/support/mocks';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HealthReport } from './health.types';

const reportWith = (database: 'up' | 'down'): HealthReport => ({
  status: database === 'up' ? 'ok' : 'degraded',
  service: 'Barakah Bazaar API',
  version: '0.1.0',
  environment: 'test',
  uptimeSeconds: 12,
  timestamp: new Date().toISOString(),
  checks: { database, authentication: 'up', storage: 'up', queue: 'disabled' },
});

const createResponse = (): { response: Response; status: jest.Mock; json: jest.Mock } => {
  const status = jest.fn();
  const json = jest.fn();
  status.mockReturnValue({ json });
  return { response: { status } as unknown as Response, status, json };
};

describe('HealthController', () => {
  let healthService: { check: jest.Mock };
  let controller: HealthController;

  beforeEach(() => {
    healthService = { check: jest.fn() };
    controller = new HealthController(
      healthService as unknown as HealthService,
      createMockLogger(),
    );
  });

  describe('liveness', () => {
    it('returns the report from the service', async () => {
      const report = reportWith('up');
      healthService.check.mockResolvedValue(report);

      await expect(controller.liveness()).resolves.toEqual(report);
    });

    it('still returns a report while the database is down', async () => {
      healthService.check.mockResolvedValue(reportWith('down'));

      const result = await controller.liveness();

      expect(result.status).toBe('degraded');
    });
  });

  describe('readiness', () => {
    it('answers 200 when the database is up', async () => {
      healthService.check.mockResolvedValue(reportWith('up'));
      const { response, status } = createResponse();

      await controller.readiness(response);

      expect(status).toHaveBeenCalledWith(HttpStatus.OK);
    });

    it('answers 503 when the database is down', async () => {
      healthService.check.mockResolvedValue(reportWith('down'));
      const { response, status } = createResponse();

      await controller.readiness(response);

      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('answers 503 when the check itself throws', async () => {
      healthService.check.mockRejectedValue(new Error('probe exploded'));
      const { response, status } = createResponse();

      await controller.readiness(response);

      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('sends the report as the body', async () => {
      const report = reportWith('up');
      healthService.check.mockResolvedValue(report);
      const { response, json } = createResponse();

      await controller.readiness(response);

      expect(json).toHaveBeenCalledWith(report);
    });
  });
});
