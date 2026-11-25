import { Injectable } from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { EmailVerificationService } from './verification/email-verification.service';

/**
 * Bundles the two collaborators `AuthController` needs for the registration/email-verification
 * flow: creating the account and minting/checking/resending its verification credential.
 *
 * `AuthController`'s constructor sat at 7 parameters — this project's S107 ceiling — once these
 * two were added individually. Rather than wait for an 8th collaborator to break the build, they
 * are bundled here: the seam is "the registration sub-project's own services", which is why
 * `RegistrationService` and `EmailVerificationService` are grouped together and nothing else
 * from `AuthModule` is folded in alongside them — a bundle of unrelated leftovers would be worse
 * than the constructor size it replaces.
 */
@Injectable()
export class RegistrationDependencies {
  constructor(
    readonly registration: RegistrationService,
    readonly emailVerification: EmailVerificationService,
  ) {}
}
