import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ErrorMessageTemplates,
  ErrorMessages,
  formatMessage,
} from '../../common/constants/error-messages.constants';
import { Money } from '../../common/money/money';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import { AuthService } from '../auth/auth.service';
import { AdminCatalogRepository } from '../admin/admin-catalog.repository';
import { CartConstants, CartMessages } from './cart.constants';
import { CartLine, CartRepository, CartWithItems } from './cart.repository';
import { AddCartItemDto, CartDto, CartItemDto, UpdateCartItemDto } from './dto/cart.dto';

/**
 * The customer's basket.
 *
 * Two things this service refuses to hide. A price that moved since the item was added is
 * surfaced per line rather than silently applied, because a changed price is what a customer
 * notices on the receipt and disputes. And a line asking for more than is in stock is flagged
 * on every read rather than only at checkout, so the basket tells the truth continuously.
 *
 * Neither is a hard block on the basket itself: a customer may keep something in their basket
 * that has gone up in price or briefly out of stock. Checkout is where it becomes a decision.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly repository: CartRepository,
    private readonly catalog: AdminCatalogRepository,
    private readonly authService: AuthService,
    @InjectPinoLogger(CartService.name) private readonly logger: PinoLogger,
  ) {}

  async getCart(user: AuthenticatedUser): Promise<ServiceResponse<CartDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      return await this.loadCart(owner.data);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in CartService.getCart');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async addItem(user: AuthenticatedUser, dto: AddCartItemDto): Promise<ServiceResponse<CartDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const cart = await this.repository.findOrCreate(owner.data);
      if (cart === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      const sellable = await this.resolveSellableVariant(dto.variantId);
      if (!sellable.ok) {
        return sellable;
      }

      const existing = cart.items.find((item) => item.variantId === dto.variantId);

      if (!existing) {
        const lines = cart.items.length;
        if (lines >= CartConstants.MaxLines) {
          return serviceFail(
            HttpStatus.CONFLICT,
            formatMessage(CartMessages.TooManyLinesTemplate, String(CartConstants.MaxLines)),
          );
        }
      }

      const wanted = (existing?.quantity ?? 0) + dto.quantity;
      const stock = await this.assertStock(dto.variantId, wanted);
      if (!stock.ok) {
        return stock;
      }

      const added = await this.repository.addItem(
        cart.id,
        dto.variantId,
        dto.quantity,
        sellable.data,
      );

      if (added === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return await this.loadCart(owner.data);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in CartService.addItem');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async updateItem(
    user: AuthenticatedUser,
    itemId: string,
    dto: UpdateCartItemDto,
  ): Promise<ServiceResponse<CartDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const cart = await this.repository.findCart(owner.data);
      if (!cart) {
        return CartService.missingCart(cart);
      }

      const line = await this.repository.updateItem(cart.id, itemId, dto.quantity);

      if (line === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (line === undefined) {
        return serviceFail(
          HttpStatus.NOT_FOUND,
          formatMessage(ErrorMessageTemplates.NotFound, CartConstants.CartItemResourceName),
        );
      }

      return await this.loadCart(owner.data);
    } catch (error) {
      this.logger.error({ err: error, itemId }, 'Exception occurred in CartService.updateItem');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async removeItem(user: AuthenticatedUser, itemId: string): Promise<ServiceResponse<CartDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const cart = await this.repository.findCart(owner.data);
      if (!cart) {
        return CartService.missingCart(cart);
      }

      const removed = await this.repository.removeItem(cart.id, itemId);

      if (removed === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      if (removed === undefined) {
        return serviceFail(
          HttpStatus.NOT_FOUND,
          formatMessage(ErrorMessageTemplates.NotFound, CartConstants.CartItemResourceName),
        );
      }

      return await this.loadCart(owner.data);
    } catch (error) {
      this.logger.error({ err: error, itemId }, 'Exception occurred in CartService.removeItem');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  async clear(user: AuthenticatedUser): Promise<ServiceResponse<CartDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const cart = await this.repository.findCart(owner.data);

      if (cart === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      // Clearing a basket that was never created is a no-op, not a 404 — the customer's
      // intent is already satisfied.
      if (cart !== undefined && !(await this.repository.clear(cart.id))) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
      }

      return await this.loadCart(owner.data);
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in CartService.clear');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  private async loadCart(userId: string): Promise<ServiceResponse<CartDto>> {
    const cart = await this.repository.findOrCreate(userId);

    if (cart === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    const available = await this.repository.availableByVariant(
      cart.items.map((item) => item.variantId),
    );

    if (available === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    return serviceOk(CartService.toDto(cart, available));
  }

  // ── Guards ────────────────────────────────────────────────────────────────

  /** Resolves the live price, refusing anything a customer should not be able to buy. */
  private async resolveSellableVariant(variantId: string): Promise<ServiceResponse<bigint>> {
    const variant = await this.catalog.findVariantById(variantId);

    if (variant === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    if (variant === undefined || !variant.isActive) {
      return serviceFail(HttpStatus.NOT_FOUND, CartMessages.ItemUnavailable);
    }

    const product = await this.catalog.findProductById(variant.productId);

    if (product === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    // An unpublished product is not merely hidden from browsing — it must not be reachable by
    // posting its variant id either, or the storefront's publish switch means nothing.
    if (
      product === undefined ||
      !product.isActive ||
      product.publishedAt === null ||
      product.publishedAt > new Date()
    ) {
      return serviceFail(HttpStatus.NOT_FOUND, CartMessages.ItemUnavailable);
    }

    return serviceOk(variant.pricePoysha);
  }

  private async assertStock(variantId: string, wanted: number): Promise<ServiceResponse<void>> {
    const available = await this.repository.availableByVariant([variantId]);

    if (available === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    const units = available.get(variantId) ?? 0;

    if (units <= 0) {
      return serviceFail(HttpStatus.CONFLICT, CartMessages.OutOfStock);
    }

    if (wanted > units) {
      return serviceFail(
        HttpStatus.CONFLICT,
        formatMessage(CartMessages.InsufficientStockTemplate, String(units)),
      );
    }

    return serviceOk<void>(undefined);
  }

  // ── Mapping ───────────────────────────────────────────────────────────────

  private static toDto(cart: CartWithItems, available: Map<string, number>): CartDto {
    const items = cart.items.map((line) =>
      CartService.toItemDto(line, available.get(line.variantId) ?? 0),
    );

    const subtotal = items.reduce((total, item) => total + item.lineTotalPoysha, 0);

    return {
      items,
      subtotalPoysha: subtotal,
      subtotalFormatted: Money.format(BigInt(subtotal)),
      itemCount: items.reduce((total, item) => total + item.quantity, 0),
      hasPriceChanges: items.some((item) => item.priceChanged),
      hasStockIssues: items.some((item) => item.exceedsStock),
    };
  }

  private static toItemDto(line: CartLine, availableQuantity: number): CartItemDto {
    // The basket is valued at the LIVE price. Showing the added price as the total would let
    // a customer reach checkout expecting a figure the order will not honour.
    const livePrice = line.variant.pricePoysha;
    const lineTotal = livePrice * BigInt(line.quantity);

    return {
      id: line.id,
      variantId: line.variantId,
      sku: line.variant.sku,
      productNameEn: line.variant.product.nameEn,
      productNameBn: line.variant.product.nameBn,
      variantNameEn: line.variant.nameEn,
      productSlug: line.variant.product.slug,
      imageUrl: line.variant.product.images.at(0)?.url ?? null,
      quantity: line.quantity,
      unitPricePoysha: Money.toJsonNumber(livePrice),
      unitPricePoyshaAtAdd: Money.toJsonNumber(line.unitPricePoyshaAtAdd),
      priceChanged: livePrice !== line.unitPricePoyshaAtAdd,
      lineTotalPoysha: Money.toJsonNumber(lineTotal),
      lineTotalFormatted: Money.format(lineTotal),
      availableQuantity,
      exceedsStock: line.quantity > availableQuantity,
    };
  }

  private static missingCart(cart: null | undefined): ServiceResponse<CartDto> {
    if (cart === null) {
      return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, ErrorMessages.ServiceUnavailable);
    }

    return serviceFail(
      HttpStatus.NOT_FOUND,
      formatMessage(ErrorMessageTemplates.NotFound, CartConstants.CartItemResourceName),
    );
  }
}
