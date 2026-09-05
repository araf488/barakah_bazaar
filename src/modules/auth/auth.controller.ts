import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { ThrottleBuckets } from '../../config/throttler.config';
import { AuthConstants, AuthMessages } from './auth.constants';
import { AuthEventsService } from './auth-events.service';
import { AuthMapper } from './auth.mapper';
import { AuthService } from './auth.service';
import { LoginDto, LoginResponseDto, MfaVerifyDto, RefreshDto } from './dto/login.dto';
import {
  MfaDisableDto,
  MfaEnableDto,
  MfaEnableResponseDto,
  MfaSetupDto,
  MfaSetupResponseDto,
} from './dto/mfa.dto';
import { LogoutAllResponseDto, SessionSummaryDto } from './dto/session.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { LoginService } from './login.service';
import { MfaService } from './mfa.service';
import { SessionService } from './sessions/session.service';

@ApiTags('Auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly loginService: LoginService,
    private readonly mfaService: MfaService,
    private readonly sessionService: SessionService,
    @InjectPinoLogger(AuthController.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Returns the caller's own profile. The local row already exists — SessionAuthGuard
   * resolved and validated it before this handler ever runs.
   */
  @Get('me')
  @ApiOperation({ summary: "Get the current user's profile" })
  @ApiResponse({ status: HttpStatus.OK, type: UserProfileDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Account disabled' })
  async me(@CurrentUser() user: AuthenticatedUser | undefined): Promise<UserProfileDto> {
    try {
      if (!user) {
        throw new UnauthorizedException(ErrorMessages.MissingAccessToken);
      }
      return unwrapOrThrow(await this.authService.resolveProfile(user));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthController.me');
      throw error;
    }
  }

  /**
   * Verifies a password and, depending on the account, either signs the device in or hands
   * back an intermediate token: `mfa` when a second factor is already enrolled, `enrolment`
   * when staff policy requires one that has not been set up yet.
   */
  @Public()
  @RateLimit(ThrottleBuckets.AuthIp, ThrottleBuckets.AuthAccount)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({ summary: 'Sign in with an email and password' })
  @ApiResponse({ status: HttpStatus.OK, type: LoginResponseDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Wrong password or unknown email' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Disabled or unverified account' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Missing X-Device-Id' })
  async login(@Body() dto: LoginDto, @Req() request: Request): Promise<LoginResponseDto> {
    try {
      const deviceId = AuthController.requireDeviceId(request);
      const result = unwrapOrThrow(
        await this.loginService.login(
          dto,
          deviceId,
          AuthController.userAgent(request),
          request.ip ?? null,
        ),
      );
      return AuthMapper.toLoginResponse(result);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthController.login');
      throw error;
    }
  }

  /**
   * Completes a login that returned `kind: 'mfa'`: exchanges the `mfaToken` plus a TOTP code
   * or a recovery code for a session.
   */
  @Public()
  @RateLimit(ThrottleBuckets.AuthIp, ThrottleBuckets.AuthAccount)
  @HttpCode(HttpStatus.OK)
  @Post('login/mfa')
  @ApiOperation({ summary: 'Complete a login with a second factor' })
  @ApiResponse({ status: HttpStatus.OK, type: LoginResponseDto })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid token, code or recovery code',
  })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Too many wrong codes' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Missing X-Device-Id' })
  async verifyMfa(@Body() dto: MfaVerifyDto, @Req() request: Request): Promise<LoginResponseDto> {
    try {
      const deviceId = AuthController.requireDeviceId(request);
      const session = unwrapOrThrow(
        await this.mfaService.verifyLogin(
          dto.mfaToken,
          { code: dto.code, recoveryCode: dto.recoveryCode },
          deviceId,
          AuthController.userAgent(request),
          request.ip ?? null,
        ),
      );
      return AuthMapper.toSessionResponse(session);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthController.verifyMfa');
      throw error;
    }
  }

  /**
   * Rotates a refresh token for a new access token.
   *
   * Client contract: persist only the `refreshToken` this call returns, and only when it
   * differs from the one you sent — presenting the *same* token again if two refreshes ever
   * race is expected and returns the previous generation's token unchanged (see
   * `SessionService.refresh`); persisting that echoed value over a token another request
   * already rotated away from signs you out at the next refresh.
   */
  @Public()
  @RateLimit(ThrottleBuckets.AuthIp, ThrottleBuckets.AuthAccount)
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a refresh token for a new access token' })
  @ApiResponse({ status: HttpStatus.OK, type: LoginResponseDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unusable refresh token' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Missing X-Device-Id' })
  async refresh(@Body() dto: RefreshDto, @Req() request: Request): Promise<LoginResponseDto> {
    try {
      const deviceId = AuthController.requireDeviceId(request);
      const session = unwrapOrThrow(
        await this.sessionService.refresh(
          dto.refreshToken,
          deviceId,
          AuthController.userAgent(request),
          request.ip ?? null,
        ),
      );
      return AuthMapper.toSessionResponse(session);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthController.refresh');
      throw error;
    }
  }

  /**
   * Issues a TOTP secret against the `enrolmentToken` that `POST /auth/login` hands to a staff
   * account which must enrol before it can sign in.
   *
   * `@Public()`, and necessarily so: the caller has no session — being unable to obtain one
   * without a second factor is precisely why they are here. The enrolment token is the
   * credential, it is bound to the same device as the login that produced it, and it lives five
   * minutes.
   *
   * Calling this again replaces an unconfirmed secret, which is what a caller who lost the QR
   * code before scanning it needs. It cannot overwrite a *confirmed* factor by itself —
   * `login` only issues an enrolment token to an account that has none enabled.
   */
  @Public()
  @RateLimit(ThrottleBuckets.AuthIp)
  @HttpCode(HttpStatus.OK)
  @Post('mfa/setup')
  @ApiOperation({ summary: 'Begin second-factor enrolment' })
  @ApiResponse({ status: HttpStatus.OK, type: MfaSetupResponseDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid or expired token' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Missing X-Device-Id' })
  async mfaSetup(@Body() dto: MfaSetupDto, @Req() request: Request): Promise<MfaSetupResponseDto> {
    try {
      const deviceId = AuthController.requireDeviceId(request);
      return unwrapOrThrow(await this.mfaService.setupForEnrolment(dto.enrolmentToken, deviceId));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthController.mfaSetup');
      throw error;
    }
  }

  /**
   * Confirms the secret `mfa/setup` issued and turns the factor on, returning the ten recovery
   * codes. This is the only time they are readable — only their hashes are stored.
   *
   * The caller signs in again afterwards: this deliberately does not issue a session. Enrolling
   * proves possession of the factor, not of the password, and the password was verified in a
   * login whose token expires in five minutes. Handing back a session here would make enrolment
   * a second way to authenticate.
   */
  @Public()
  @RateLimit(ThrottleBuckets.AuthIp)
  @HttpCode(HttpStatus.OK)
  @Post('mfa/enable')
  @ApiOperation({ summary: 'Confirm second-factor enrolment and collect recovery codes' })
  @ApiResponse({ status: HttpStatus.OK, type: MfaEnableResponseDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid token or code' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Setup has not run yet' })
  async mfaEnable(
    @Body() dto: MfaEnableDto,
    @Req() request: Request,
  ): Promise<MfaEnableResponseDto> {
    try {
      const deviceId = AuthController.requireDeviceId(request);
      const result = unwrapOrThrow(
        await this.mfaService.enableForEnrolment(dto.enrolmentToken, deviceId, dto.code),
      );
      return { recoveryCodes: [...result.recoveryCodes] };
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthController.mfaEnable');
      throw error;
    }
  }

  /**
   * Turns the caller's second factor off. Bearer, not an enrolment token: you must be signed in
   * to give up a factor you already hold.
   *
   * Refused for staff while `staffMfaRequired` is set — `MfaService.disable` owns that rule, so
   * turning the setting off is the only way to lift it.
   */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('mfa/disable')
  @ApiOperation({ summary: 'Turn off the second factor' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Wrong password or code' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Staff may not disable it' })
  async mfaDisable(
    @Body() dto: MfaDisableDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<void> {
    try {
      const authenticated = AuthController.require(user);
      unwrapOrThrow(
        await this.mfaService.disableForUser(authenticated.userId, dto.password, dto.code),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthController.mfaDisable');
      throw error;
    }
  }

  /**
   * Ends the session the caller is using right now. Idempotent — see `SessionService.revoke`.
   */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  @ApiOperation({ summary: 'End the current session' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  async logout(@CurrentUser() user: AuthenticatedUser | undefined): Promise<void> {
    try {
      const authenticated = AuthController.require(user);
      unwrapOrThrow(
        await this.sessionService.revoke(
          authenticated.sessionId,
          AuthEventsService.actorFrom(authenticated),
        ),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthController.logout');
      throw error;
    }
  }

  /**
   * Ends every live session the caller has — including the one making this request.
   * `SessionService.revokeAll` makes no exception for the calling session ("ends every live
   * session a user has"), and this route does not add one: it is a full sign-out everywhere,
   * not "everywhere but here". The reported count is whatever the service actually revoked.
   */
  @HttpCode(HttpStatus.OK)
  @Post('logout-all')
  @ApiOperation({ summary: 'End every session for the caller, including this one' })
  @ApiResponse({ status: HttpStatus.OK, type: LogoutAllResponseDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<LogoutAllResponseDto> {
    try {
      const authenticated = AuthController.require(user);
      const revoked = unwrapOrThrow(
        await this.sessionService.revokeAll(
          authenticated.userId,
          AuthEventsService.actorFrom(authenticated),
        ),
      );
      return { revoked };
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthController.logoutAll');
      throw error;
    }
  }

  /**
   * The caller's own live sessions, newest first — "where am I signed in".
   */
  @Get('sessions')
  @ApiOperation({ summary: "List the caller's live sessions" })
  @ApiResponse({ status: HttpStatus.OK, type: [SessionSummaryDto] })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  async listSessions(
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<SessionSummaryDto[]> {
    try {
      const authenticated = AuthController.require(user);
      const sessions = unwrapOrThrow(await this.sessionService.listForUser(authenticated.userId));
      return sessions.map((session) =>
        AuthMapper.toSessionSummary(session, authenticated.sessionId),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthController.listSessions');
      throw error;
    }
  }

  /**
   * Ends one session the caller owns. A session that does not exist, or exists but belongs to
   * someone else, answers 404 either way — see `SessionService.revokeOwned`.
   */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('sessions/:id')
  @ApiOperation({ summary: "End one of the caller's own sessions" })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  async deleteSession(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    try {
      const authenticated = AuthController.require(user);
      unwrapOrThrow(await this.sessionService.revokeOwned(authenticated.userId, id));
    } catch (error) {
      this.logger.error(
        { err: error, sessionId: id },
        'Exception occurred in AuthController.deleteSession',
      );
      throw error;
    }
  }

  /**
   * `@CurrentUser()` is undefined only on `@Public()` routes; none of the session routes are,
   * so this is a guard-order safety net rather than an expected path.
   */
  private static require(user: AuthenticatedUser | undefined): AuthenticatedUser {
    if (!user) {
      throw new UnauthorizedException(ErrorMessages.MissingAccessToken);
    }
    return user;
  }

  /**
   * The caller's declared device id, required on every route that mints or refreshes a
   * session. Mirrors `SessionAuthGuard`'s own reading of the header, but this is a 400 —
   * malformed input — rather than the guard's 401, since no credential has been checked yet.
   */
  private static requireDeviceId(request: Request): string {
    const value = request.headers[AuthConstants.DeviceIdHeader] as string | undefined;

    if (!value || value.length > AuthConstants.DeviceIdMaxLength) {
      throw new BadRequestException(AuthMessages.DeviceIdRequired);
    }

    return value;
  }

  private static userAgent(request: Request): string | null {
    const value = request.headers['user-agent'];
    return typeof value === 'string' ? value : null;
  }
}
