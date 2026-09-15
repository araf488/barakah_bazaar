import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { Language, User } from '../../infra/prisma/prisma-client';
import { EmailSender } from '../notification/ports/email-sender.port';
import { AuthTokens } from './auth.constants';
import { AuthRepository } from './auth.repository';
import { PasswordHasher } from './crypto/password-hasher';
import { RegisterDto } from './dto/register.dto';
import { buildAlreadyRegisteredEmail } from './emails/verification-emails';
import { PasswordPolicy } from './passwords/password-policy';
import { EmailVerificationService } from './verification/email-verification.service';

/**
 * Creates customer accounts.
 *
 * The endpoint behind this is enumeration-safe: the caller gets the same answer whether or not
 * the address already has an account. That is why it returns no session — a session cannot be
 * issued for an account the caller has not authenticated against, so returning one would make
 * the two paths visibly different.
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly hasher: PasswordHasher,
    private readonly policy: PasswordPolicy,
    private readonly verification: EmailVerificationService,
    @Inject(AuthTokens.EmailSender) private readonly email: EmailSender,
    @InjectPinoLogger(RegistrationService.name) private readonly logger: PinoLogger,
  ) {}

  async register(dto: RegisterDto): Promise<ServiceResponse<void>> {
    try {
      // First, and before any database read: the policy depends only on what was submitted, so
      // it leaks nothing, and a weak password is refused without spending a query.
      const policyFailure = this.policy.check(dto.password, {
        email: dto.email,
        fullName: dto.fullName,
      });

      if (policyFailure) {
        return serviceFail(HttpStatus.BAD_REQUEST, policyFailure);
      }

      const existing = await this.repository.findByEmail(dto.email);

      if (existing === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (existing) {
        await this.handleExisting(existing, dto.password);
        return serviceOk(undefined);
      }

      return await this.createAccount(dto);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in RegistrationService.register');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  /**
   * The already-registered path.
   *
   * The dummy hash is not decoration. Creating an account runs scrypt, which costs on the order
   * of 100 ms by design; without an equivalent cost here the two paths return identical bodies
   * at visibly different times, and the clock becomes the oracle the bodies were hiding. This is
   * the same device `LoginService` uses on its not-found path.
   */
  private async handleExisting(user: User, password: string): Promise<void> {
    await this.hasher.verify(password, PasswordHasher.DUMMY_HASH);

    // No credential of any kind: whoever triggered this may not be the account's owner.
    await this.email.send(
      buildAlreadyRegisteredEmail({ to: user.email, fullName: user.fullName ?? '' }),
    );
  }

  private async createAccount(dto: RegisterDto): Promise<ServiceResponse<void>> {
    const passwordHash = await this.hasher.hash(dto.password);

    const user = await this.repository.createCustomer({
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      preferredLanguage: dto.preferredLanguage ?? Language.BN,
    });

    if (!user) {
      // Includes losing a race to another registration for the same address. "Could not create"
      // is all the caller needs, and all it is told.
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    await this.verification.issueFor(user);
    return serviceOk(undefined);
  }
}
