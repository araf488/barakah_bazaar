import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { UserRole } from '../../infra/prisma/prisma-client';
import { AdminOrderQueryDto, OrderDto, TransitionOrderDto } from './dto/order.dto';
import { OrderConstants } from './order.constants';
import { OrderService } from './order.service';

/**
 * Order management for staff.
 *
 * `SUPER_ADMIN` and `OPS` — OPS is the role that runs orders, and this is the first work it
 * has. WAREHOUSE moves stock but does not decide an order's fate, and MARKETING has no
 * business seeing customer addresses and phone numbers in bulk.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN, UserRole.OPS)
@Controller(OrderConstants.AdminRouteBase)
export class AdminOrderController {
  constructor(
    private readonly orderService: OrderService,
    @InjectPinoLogger(AdminOrderController.name) private readonly logger: PinoLogger,
  ) {}

  @Get()
  @ApiOperation({ summary: 'All orders, newest first' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto })
  async list(@Query() query: AdminOrderQueryDto): Promise<PaginatedResponseDto<OrderDto>> {
    try {
      return unwrapOrThrow(await this.orderService.listAllOrders(query));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminOrderController.list');
      throw error;
    }
  }

  /**
   * Moves an order along.
   *
   * The transition is checked against the state machine, and DISPATCHED is where reserved
   * stock actually leaves the shelf — so this route is also how inventory settles.
   */
  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Advance an order to its next status' })
  @ApiResponse({ status: HttpStatus.OK, type: OrderDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Illegal transition' })
  async transition(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionOrderDto,
  ): Promise<OrderDto> {
    try {
      return unwrapOrThrow(
        await this.orderService.transitionOrder(AdminOrderController.require(user), id, dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error, orderId: id },
        'Exception occurred in AdminOrderController.transition',
      );
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
