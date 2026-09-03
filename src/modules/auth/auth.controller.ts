import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { AuthMapper } from './auth.mapper';
import { AuthService } from './auth.service';
import { LoginDto, LoginResponseDto, MfaVerifyDto, RefreshDto } from './dto/login.dto';
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
  @RateLimit(ThrottleBuckets.Auth)
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
  @RateLimit(ThrottleBuckets.Auth)
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
  @RateLimit(ThrottleBuckets.Auth)
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
