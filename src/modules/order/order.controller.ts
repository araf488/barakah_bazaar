import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { CancelOrderDto, OrderDto, OrderQueryDto, PlaceOrderDto } from './dto/order.dto';
import { OrderConstants } from './order.constants';
import { OrderService } from './order.service';

/**
 * The customer's own orders.
 *
 * No `@Roles` — any signed-in customer. Every route resolves the order through the caller's
 * user id in the query predicate, so another customer's order id yields 404 rather than
 * somebody else's address and phone number.
 */
@ApiTags('Orders')
@ApiBearerAuth()
@Controller(OrderConstants.RouteBase)
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    @InjectPinoLogger(OrderController.name) private readonly logger: PinoLogger,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Place an order from the current basket' })
  @ApiResponse({ status: HttpStatus.CREATED, type: OrderDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Empty basket, price change, or stock' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "Address is not the caller's" })
  async place(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: PlaceOrderDto,
  ): Promise<OrderDto> {
    try {
      return unwrapOrThrow(await this.orderService.placeOrder(OrderController.require(user), dto));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in OrderController.place');
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: 'My orders, newest first' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto })
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query() query: OrderQueryDto,
  ): Promise<PaginatedResponseDto<OrderDto>> {
    try {
      return unwrapOrThrow(
        await this.orderService.listMyOrders(OrderController.require(user), query),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in OrderController.list');
      throw error;
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my orders, with its history' })
  @ApiResponse({ status: HttpStatus.OK, type: OrderDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  async get(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderDto> {
    try {
      return unwrapOrThrow(await this.orderService.getMyOrder(OrderController.require(user), id));
    } catch (error) {
      this.logger.error({ err: error, orderId: id }, 'Exception occurred in OrderController.get');
      throw error;
    }
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel my order, before it is dispatched' })
  @ApiResponse({ status: HttpStatus.OK, type: OrderDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Already dispatched' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ): Promise<OrderDto> {
    try {
      return unwrapOrThrow(
        await this.orderService.cancelMyOrder(OrderController.require(user), id, dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error, orderId: id },
        'Exception occurred in OrderController.cancel',
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
