import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { WebMountState } from '../../web/web-mount-state';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  // WebMountState lives here because health is its only reader; main.ts marks it through
  // app.get() once the web mount is prepared.
  providers: [HealthService, WebMountState],
})
export class HealthModule {}
