import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator';
import { ErrorMessages } from '../../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../../common/types/service-response';
import { ThrottleBuckets } from '../../../config/throttler.config';
import { AuthMapper } from '../auth.mapper';
import { LoginResponseDto } from '../dto/login.dto';
import { requireDeviceId, userAgentOf } from '../request-context';
import {
  PhoneConfirmDto,
  PhoneCodeSentDto,
  PhoneRequestDto,
  PhoneVerifiedDto,
} from './dto/phone.dto';
import { PhoneLoginService } from './phone-login.service';
import { PhoneVerificationService } from './phone-verification.service';

@ApiTags('Auth')
@ApiBearerAuth()
@Controller('auth/phone')
export class PhoneController {
  constructor(
    private readonly verification: PhoneVerificationService,
    private readonly phoneLogin: PhoneLoginService,
    @InjectPinoLogger(PhoneController.name) private readonly logger: PinoLogger,
  ) {}

  /** Texts a code to a number the signed-in customer wants to verify. */
  @RateLimit(ThrottleBuckets.AuthIp, ThrottleBuckets.AuthPhone)
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('verification')
  @ApiOperation({ summary: 'Text a verification code to a phone number' })
  @ApiResponse({ status: HttpStatus.ACCEPTED, type: PhoneCodeSentDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Malformed phone number' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Not signed in' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Number in use or already verified' })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Cooldown, daily limit per number or per account, or throttled',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Daily SMS limit reached, the text could not be sent, or a database fault',
  })
  async request(
    @Body() dto: PhoneRequestDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<PhoneCodeSentDto> {
    try {
      return unwrapOrThrow(await this.verification.request(PhoneController.require(user), dto));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PhoneController.request');
      throw error;
    }
  }

  /** Checks the texted code and links the number to the signed-in account. */
  @RateLimit(ThrottleBuckets.AuthIp, ThrottleBuckets.AuthPhone)
  @HttpCode(HttpStatus.OK)
  @Post('verification/confirm')
  @ApiOperation({ summary: 'Confirm a phone number with the texted code' })
  @ApiResponse({ status: HttpStatus.OK, type: PhoneVerifiedDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Wrong code, or a malformed body' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Not signed in' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Another account verified the number first',
  })
  @ApiResponse({ status: HttpStatus.GONE, description: 'Code expired or spent' })
  @ApiResponse({ status: HttpStatus.SERVICE_UNAVAILABLE, description: 'Database fault' })
  async confirm(
    @Body() dto: PhoneConfirmDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<PhoneVerifiedDto> {
    try {
      return unwrapOrThrow(await this.verification.confirm(PhoneController.require(user), dto));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PhoneController.confirm');
      throw error;
    }
  }

  /**
   * Texts a sign-in code to a number. `@Public()`, necessarily: the caller has no session yet.
   * The answer is the same whether or not the number belongs to an account.
   */
  @Public()
  @RateLimit(ThrottleBuckets.AuthIp, ThrottleBuckets.AuthPhone)
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('login')
  @ApiOperation({ summary: 'Text a sign-in code to a verified phone number' })
  @ApiResponse({ status: HttpStatus.ACCEPTED, type: PhoneCodeSentDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Malformed phone number' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Throttled (IP or number)' })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Daily SMS limit reached, or a database fault',
  })
  async loginRequest(
    @Body() dto: PhoneRequestDto,
    @Req() request: Request,
  ): Promise<PhoneCodeSentDto> {
    try {
      return unwrapOrThrow(await this.phoneLogin.request(dto, request.ip ?? null));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PhoneController.loginRequest');
      throw error;
    }
  }

  /** Checks the texted code and signs the customer in, answering like `POST /auth/login`. */
  @Public()
  @RateLimit(ThrottleBuckets.AuthIp, ThrottleBuckets.AuthPhone)
  @HttpCode(HttpStatus.OK)
  @Post('login/verify')
  @ApiOperation({ summary: 'Sign in with a texted code' })
  @ApiResponse({ status: HttpStatus.OK, type: LoginResponseDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Wrong, expired or spent code' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Missing X-Device-Id, or a malformed body',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Account disabled, or email verification overdue',
  })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Throttled (IP or number)' })
  @ApiResponse({ status: HttpStatus.SERVICE_UNAVAILABLE, description: 'Database fault' })
  async loginVerify(
    @Body() dto: PhoneConfirmDto,
    @Req() request: Request,
  ): Promise<LoginResponseDto> {
    try {
      const deviceId = requireDeviceId(request);
      const result = unwrapOrThrow(
        await this.phoneLogin.verify(dto, deviceId, userAgentOf(request), request.ip ?? null),
      );
      return AuthMapper.toLoginResponse(result);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in PhoneController.loginVerify');
      throw error;
    }
  }

  private static require(user: AuthenticatedUser | undefined): AuthenticatedUser {
    if (!user) {
      throw new UnauthorizedException(ErrorMessages.MissingAccessToken);
    }
    return user;
  }
}
