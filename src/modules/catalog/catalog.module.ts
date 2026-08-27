import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

/**
 * Read-side catalog. Write-side (admin product/category CRUD, CSV import)
 * belongs to the Admin module and is scheduled for Phase 2B.
 */
@Module({
  controllers: [CatalogController],
  providers: [CatalogService, CatalogRepository],
  exports: [CatalogService],
})
export class CatalogModule {}
