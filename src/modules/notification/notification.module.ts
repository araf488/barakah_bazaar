import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { AuthModule } from '../auth/auth.module';
import { createSmsGateway } from '../auth/gateways/sms-gateway.factory';
import { OrderRepository } from '../order/order.repository';
import { NotificationConstants, NotificationTokens } from './notification.constants';
import { NotificationController } from './notification.controller';
import { NotificationRepository } from './notification.repository';
import { NotificationRetryService } from './notification-retry.service';
import { NotificationService } from './notification.service';

/**
 * Transactional messaging.
 *
 * The SMS gateway is bound here rather than imported from AuthModule so the two seams stay
 * independent: auth sends OTPs and this module sends order updates, and a deployment may well
 * want a different sender id or provider for each. Both default to the noop adapter, so a
 * fresh clone boots and the suite passes with no SMS account and no spend.
 *
 * OrderRepository is provided directly instead of importing OrderModule: the order module
 * depends on this one for its notifications, and importing it back would be a cycle.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationRepository,
    NotificationRetryService,
    OrderRepository,
    {
      provide: NotificationTokens.SmsGateway,
      inject: [ConfigService, PinoLogger],
      useFactory: createSmsGateway,
    },
  ],
  exports: [NotificationService],
})
export class NotificationModule {
  /** Re-exported so consumers do not import the constants file directly. */
  static readonly constants = NotificationConstants;
}
