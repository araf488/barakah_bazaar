import { Injectable } from '@nestjs/common';
import { PasswordResetService } from './password-reset/password-reset.service';
import { PasswordChangeService } from './passwords/password-change.service';

/**
 * Bundles the password sub-project's two services for `AuthController`: recovering a forgotten
 * password and changing a known one. Grouped because they are one sub-project's own services,
 * the same seam `RegistrationDependencies` follows. Nothing unrelated belongs here.
 */
@Injectable()
export class PasswordDependencies {
  constructor(
    readonly passwordReset: PasswordResetService,
    readonly passwordChange: PasswordChangeService,
  ) {}
}
