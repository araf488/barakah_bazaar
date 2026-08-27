import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';
import { HealthReport } from './health.types';

/**
 * Liveness and readiness probes.
 *
 * `/health` always answers 200 while the process is up — a load balancer must
 * not recycle an instance just because Postgres blipped. `/health/ready`
 * answers 503 when a dependency needed to serve traffic is down, which is what
 * a deployment gate should watch.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    @InjectPinoLogger(HealthController.name) private readonly logger: PinoLogger,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe with per-dependency detail' })
  @ApiResponse({ status: HttpStatus.OK })
  async liveness(): Promise<HealthReport> {
    try {
      return await this.healthService.check();
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in HealthController.liveness');
      throw error;
    }
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe; 503 when the database is unreachable' })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.SERVICE_UNAVAILABLE })
  async readiness(@Res() response: Response): Promise<void> {
    try {
      const report = await this.healthService.check();
      const status =
        report.checks.database === 'up' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
      response.status(status).json(report);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in HealthController.readiness');
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({ status: 'degraded' });
    }
  }
}
