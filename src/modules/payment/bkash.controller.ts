import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Redirect,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { ThrottleBuckets } from '../../config/throttler.config';
import { AppConfigService } from '../../config';
import { BkashCheckoutService, CallbackResult } from './bkash-checkout.service';
import { BkashCheckoutStartedDto } from './dto/bkash.dto';
import { BkashOutcome, PaymentConstants } from './payment.constants';
import { joinUrl } from './payment-url';

/** What the callback answers: a redirect Nest turns into a `Location` header. */
export interface CallbackRedirect {
  url: string;
  statusCode: number;
}

/**
 * bKash Tokenized Checkout, customer side: starting a payment, and the callback bKash sends the
 * customer's browser back to.
 *
 * The callback is a browser navigation, so it never answers an error page: whatever happens it
 * is a 302 to the storefront result page, and the query string only picks which bKash call to
 * make. The outcome always comes from bKash and the ledger, never from the URL.
 */
@ApiTags('Payments')
@Controller()
export class BkashController {
  constructor(
    private readonly checkout: BkashCheckoutService,
    @Inject(ConfigService) private readonly config: AppConfigService,
    @InjectPinoLogger(BkashController.name) private readonly logger: PinoLogger,
  ) {}

  @Post(PaymentConstants.BkashStartRoute)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start a bKash payment for one of my orders' })
  @ApiResponse({ status: HttpStatus.CREATED, type: BkashCheckoutStartedDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not my order' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Not a bKash order, not payable, already paid, or the payment window has closed',
  })
  @ApiResponse({ status: HttpStatus.BAD_GATEWAY, description: 'bKash could not start the payment' })
  @ApiResponse({ status: HttpStatus.SERVICE_UNAVAILABLE, description: 'bKash is not available' })
  async start(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BkashCheckoutStartedDto> {
    try {
      return unwrapOrThrow(await this.checkout.start(BkashController.require(user), id));
    } catch (error) {
      this.logger.error({ err: error, orderId: id }, 'Exception occurred in BkashController.start');
      throw error;
    }
  }

  @Public()
  @RateLimit(ThrottleBuckets.AuthIp)
  @Get(PaymentConstants.BkashCallbackRoute)
  @Redirect()
  @ApiOperation({ summary: "Where bKash sends the customer's browser back; always a 302" })
  @ApiQuery({ name: 'paymentID', required: true, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiResponse({ status: HttpStatus.FOUND, description: 'Redirect to the storefront result page' })
  async callback(
    @Query('paymentID') paymentId: unknown,
    @Query('status') status: unknown,
  ): Promise<CallbackRedirect> {
    try {
      const id = BkashController.paymentIdFrom(paymentId);

      if (id === undefined) {
        return this.redirect({ outcome: BkashOutcome.Failed, orderNumber: null });
      }

      const result = await this.checkout.handleCallback(
        id,
        typeof status === 'string' ? status : undefined,
      );
      return this.redirect(result);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in BkashController.callback');
      return this.redirect({ outcome: BkashOutcome.Failed, orderNumber: null });
    }
  }

  /** The storefront result URL. Every value goes through `searchParams`, never concatenation. */
  private redirect(result: CallbackResult): CallbackRedirect {
    const base = this.config.get('APP_PUBLIC_BASE_URL', { infer: true });
    const url = new URL(joinUrl(base, PaymentConstants.ResultPath));

    if (result.orderNumber !== null) {
      url.searchParams.set(PaymentConstants.ResultOrderParam, result.orderNumber);
    }
    url.searchParams.set(PaymentConstants.ResultOutcomeParam, result.outcome);

    return { url: url.toString(), statusCode: HttpStatus.FOUND };
  }

  /** The `paymentID` when it is one non-empty string of a sane length; otherwise nothing. */
  private static paymentIdFrom(value: unknown): string | undefined {
    const valid =
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= PaymentConstants.MaxCallbackPaymentIdLength;

    return valid ? value : undefined;
  }

  private static require(user: AuthenticatedUser | undefined): AuthenticatedUser {
    if (!user) {
      throw new UnauthorizedException(ErrorMessages.MissingAccessToken);
    }
    return user;
  }
}
