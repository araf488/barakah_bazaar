import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { CartConstants } from './cart.constants';
import { CartService } from './cart.service';
import { AddCartItemDto, CartDto, UpdateCartItemDto } from './dto/cart.dto';

/**
 * The customer's own basket.
 *
 * No `@Roles` — any signed-in customer may use it, which is the default for an authenticated
 * route. There is no id in any path that names a cart: the basket is always the caller's,
 * resolved from their token, so there is nothing to enumerate.
 *
 * Every mutation returns the whole basket rather than the changed line. The storefront needs
 * the recalculated subtotal, price-change flags and stock warnings after any change anyway,
 * and returning them together removes a round trip and a chance to render a stale total.
 */
@ApiTags('Cart')
@ApiBearerAuth()
@Controller(CartConstants.RouteBase)
export class CartController {
  constructor(
    private readonly cartService: CartService,
    @InjectPinoLogger(CartController.name) private readonly logger: PinoLogger,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The current basket, priced live' })
  @ApiResponse({ status: HttpStatus.OK, type: CartDto })
  async getCart(@CurrentUser() user: AuthenticatedUser | undefined): Promise<CartDto> {
    try {
      return unwrapOrThrow(await this.cartService.getCart(CartController.require(user)));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in CartController.getCart');
      throw error;
    }
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add to the basket, or raise an existing line' })
  @ApiResponse({ status: HttpStatus.OK, type: CartDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Item is unavailable' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Out of stock, or basket full' })
  async addItem(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: AddCartItemDto,
  ): Promise<CartDto> {
    try {
      return unwrapOrThrow(await this.cartService.addItem(CartController.require(user), dto));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in CartController.addItem');
      throw error;
    }
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Set a line to an absolute quantity' })
  @ApiResponse({ status: HttpStatus.OK, type: CartDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  async updateItem(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartDto> {
    try {
      return unwrapOrThrow(
        await this.cartService.updateItem(CartController.require(user), id, dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error, itemId: id },
        'Exception occurred in CartController.updateItem',
      );
      throw error;
    }
  }

  @Delete('items/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a line' })
  @ApiResponse({ status: HttpStatus.OK, type: CartDto })
  async removeItem(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CartDto> {
    try {
      return unwrapOrThrow(await this.cartService.removeItem(CartController.require(user), id));
    } catch (error) {
      this.logger.error(
        { err: error, itemId: id },
        'Exception occurred in CartController.removeItem',
      );
      throw error;
    }
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Empty the basket' })
  @ApiResponse({ status: HttpStatus.OK, type: CartDto })
  async clear(@CurrentUser() user: AuthenticatedUser | undefined): Promise<CartDto> {
    try {
      return unwrapOrThrow(await this.cartService.clear(CartController.require(user)));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in CartController.clear');
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
