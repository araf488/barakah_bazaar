import { Injectable } from '@nestjs/common';
import { CartRepository } from '../cart/cart.repository';
import { InventoryRepository } from '../inventory/inventory.repository';
import { AddressRepository } from '../user/address.repository';

/**
 * The stores checkout *reads* to assemble an order, bundled as one collaborator.
 *
 * OrderService already owns the order store itself; these three are inputs it consults and
 * never writes. Grouping them keeps the constructor well under the seven-parameter ceiling as
 * checkout grows, rather than adding one more repository each time and landing on the limit.
 */
@Injectable()
export class CheckoutSources {
  constructor(
    readonly carts: CartRepository,
    readonly addresses: AddressRepository,
    readonly inventory: InventoryRepository,
  ) {}
}
