import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';

/**
 * Bangladesh reference geography. Exports GeoService because address writes (UserModule)
 * and, later, delivery routing both validate against the same dataset — the alternative is
 * two copies that drift.
 */
@Module({
  controllers: [GeoController],
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
