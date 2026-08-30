import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { InventoryController } from './inventory.controller';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';

/**
 * Warehouse stock, batches and the stock ledger.
 *
 * Imports AdminModule for the catalog repository — a receipt has to confirm the variant is
 * real and sellable, and duplicating that lookup would mean two answers to the same question.
 */
@Module({
  imports: [AuthModule, AdminModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryRepository],
  exports: [InventoryService],
})
export class InventoryModule {}
