import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { CartController } from './cart.controller';
import { CartRepository } from './cart.repository';
import { CartService } from './cart.service';

/**
 * The customer's basket.
 *
 * Imports AdminModule for the catalog repository: adding an item has to confirm the variant
 * is active AND its product published, and a second copy of that lookup would eventually
 * disagree with the first.
 */
@Module({
  imports: [AuthModule, AdminModule],
  controllers: [CartController],
  providers: [CartService, CartRepository],
  exports: [CartService],
})
export class CartModule {}
