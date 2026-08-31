import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { UserRole } from '../../infra/prisma/prisma-client';
import { PaymentConstants } from './payment.constants';
import { PaymentService } from './payment.service';
import {
  CollectCashDto,
  OrderPaymentSummaryDto,
  PaymentListDto,
  PaymentQueryDto,
  PaymentTransactionDto,
  RefundOrderDto,
} from './dto/payment.dto';

/**
 * The money ledger, for staff.
 *
 * `SUPER_ADMIN` and `OPS`, matching order management: the people who run orders are the ones
 * who reconcile the cash from them. WAREHOUSE moves stock and never touches money.
 *
 * Recording cash is a POST rather than a side effect of marking an order delivered, on
 * purpose. An order can be marked delivered by someone who never handled the notes, and
 * inferring revenue from a status change would put money in the books that nobody counted.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN, UserRole.OPS)
@Controller(PaymentConstants.AdminRouteBase)
export class AdminPaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    @InjectPinoLogger(AdminPaymentController.name) private readonly logger: PinoLogger,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The whole payment ledger, newest first' })
  @ApiResponse({ status: HttpStatus.OK, type: PaymentListDto })
  async list(@Query() query: PaymentQueryDto): Promise<PaymentListDto> {
    try {
      return unwrapOrThrow(await this.paymentService.list(query));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminPaymentController.list');
      throw error;
    }
  }

  @Get('orders/:orderId')
  @ApiOperation({ summary: 'What one order has taken and given back' })
  @ApiResponse({ status: HttpStatus.OK, type: OrderPaymentSummaryDto })
  async summary(@Param('orderId', ParseUUIDPipe) orderId: string): Promise<OrderPaymentSummaryDto> {
    try {
      return unwrapOrThrow(await this.paymentService.summaryForOrder(orderId));
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in AdminPaymentController.summary',
      );
      throw error;
    }
  }

  @Post('orders/:orderId/cash')
  @ApiOperation({ summary: 'Record cash collected at the doorstep' })
  @ApiResponse({ status: HttpStatus.CREATED, type: PaymentTransactionDto })
  async collectCash(
    @CurrentUser() staff: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CollectCashDto,
  ): Promise<PaymentTransactionDto> {
    try {
      return unwrapOrThrow(await this.paymentService.collectCash(staff, orderId, dto));
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in AdminPaymentController.collectCash',
      );
      throw error;
    }
  }

  @Post('orders/:orderId/refund')
  @ApiOperation({ summary: 'Send money back against an order' })
  @ApiResponse({ status: HttpStatus.CREATED, type: PaymentTransactionDto })
  async refund(
    @CurrentUser() staff: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: RefundOrderDto,
  ): Promise<PaymentTransactionDto> {
    try {
      return unwrapOrThrow(await this.paymentService.refund(staff, orderId, dto));
    } catch (error) {
      this.logger.error(
        { err: error, orderId },
        'Exception occurred in AdminPaymentController.refund',
      );
      throw error;
    }
  }
}
