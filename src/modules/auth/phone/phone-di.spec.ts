import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuthTokens } from '../auth.constants';
import { PhoneCodeIssuer } from './phone-code.issuer';
import { AuthRepository } from '../auth.repository';
import { PhoneController } from './phone.controller';
import { PhoneVerificationService } from './phone-verification.service';
import { PhoneLoginChallengeRepository } from './phone-login-challenge.repository';
import { AuthEventsService } from '../auth-events.service';
import { LoginService } from '../login.service';
import { PhoneLoginService } from './phone-login.service';
import { PhoneVerificationRepository } from './phone-verification.repository';

describe('phone providers dependency injection', () => {
  it('resolves every phone provider through Nest, not by hand-built constructors', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PhoneController],
      providers: [
        PhoneVerificationService,
        { provide: AuthRepository, useValue: {} },
        { provide: AuthTokens.EmailSender, useValue: { send: jest.fn() } },
        { provide: getLoggerToken(PhoneVerificationService.name), useValue: {} },
        { provide: getLoggerToken(PhoneController.name), useValue: {} },
        PhoneLoginService,
        { provide: LoginService, useValue: { completeLogin: jest.fn() } },
        { provide: AuthEventsService, useValue: { recordLoginFailed: jest.fn() } },
        { provide: getLoggerToken(PhoneLoginService.name), useValue: {} },
        PhoneCodeIssuer,
        PhoneVerificationRepository,
        PhoneLoginChallengeRepository,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: AuthTokens.SmsGateway, useValue: { send: jest.fn() } },
        { provide: AuthTokens.SessionCache, useValue: { invalidateUser: jest.fn() } },
        { provide: PrismaService, useValue: {} },
        { provide: getLoggerToken(PhoneCodeIssuer.name), useValue: {} },
        { provide: getLoggerToken(PhoneVerificationRepository.name), useValue: {} },
        { provide: getLoggerToken(PhoneLoginChallengeRepository.name), useValue: {} },
      ],
    }).compile();

    expect(moduleRef.get(PhoneVerificationService)).toBeInstanceOf(PhoneVerificationService);
    expect(moduleRef.get(PhoneLoginService)).toBeInstanceOf(PhoneLoginService);
    expect(moduleRef.get(PhoneController)).toBeInstanceOf(PhoneController);
    expect(moduleRef.get(PhoneCodeIssuer)).toBeInstanceOf(PhoneCodeIssuer);
    expect(moduleRef.get(PhoneVerificationRepository)).toBeInstanceOf(PhoneVerificationRepository);
    expect(moduleRef.get(PhoneLoginChallengeRepository)).toBeInstanceOf(
      PhoneLoginChallengeRepository,
    );
  });
});
