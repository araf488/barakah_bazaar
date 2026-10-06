import { Injectable } from '@nestjs/common';
import { LoginService } from './login.service';
import { MfaService } from './mfa.service';

/**
 * Bundles the two services that turn credentials into a session: the password step and the
 * second-factor step. `AuthController` would otherwise reach the S107 ceiling of 7 once the
 * password routes landed. That is the point where this project's rule is to bundle, rather
 * than wait for an 8th collaborator to break the build.
 */
@Injectable()
export class SignInDependencies {
  constructor(
    readonly login: LoginService,
    readonly mfa: MfaService,
  ) {}
}
