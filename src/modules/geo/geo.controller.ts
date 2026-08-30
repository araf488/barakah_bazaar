import { Controller, Get, HttpStatus, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Public } from '../../common/decorators/public.decorator';
import { unwrapOrThrow } from '../../common/types/service-response';
import { GeoAreaListDto, GeoDistrictDto, GeoDivisionDto, GeoUnitDto } from './dto/geo-response.dto';
import { GeoReverseQueryDto, GeoSearchQueryDto, GeocodedPlaceDto } from './dto/geocoding.dto';
import { GeoConstants } from './geo.constants';
import { GeoService } from './geo.service';

/**
 * Bangladesh geography lookups. Reachable without a token: the storefront has to render the
 * address form before the customer has signed in.
 *
 * Routes below district level are district-scoped rather than bare-name. "Kaliganj" names
 * four different upazilas, so `/geo/units/Kaliganj/areas` would resolve to the wrong place
 * with no error — the client has already listed the districts, so it has the extra segment.
 *
 * Synchronous, because GeoService reads an in-memory dataset.
 */
@ApiTags('Geo')
@Controller(GeoConstants.RouteBase)
export class GeoController {
  constructor(
    private readonly geoService: GeoService,
    @InjectPinoLogger(GeoController.name) private readonly logger: PinoLogger,
  ) {}

  @Public()
  @Get('divisions')
  @ApiOperation({ summary: 'All divisions of Bangladesh' })
  @ApiResponse({ status: HttpStatus.OK, type: [GeoDivisionDto] })
  listDivisions(): GeoDivisionDto[] {
    try {
      return unwrapOrThrow(this.geoService.listDivisions());
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in GeoController.listDivisions');
      throw error;
    }
  }

  @Public()
  @Get('divisions/:division/districts')
  @ApiOperation({ summary: 'Districts of one division' })
  @ApiResponse({ status: HttpStatus.OK, type: [GeoDistrictDto] })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  listDistricts(@Param('division') division: string): GeoDistrictDto[] {
    try {
      return unwrapOrThrow(this.geoService.listDistricts(division));
    } catch (error) {
      this.logger.error(
        { err: error, division },
        'Exception occurred in GeoController.listDistricts',
      );
      throw error;
    }
  }

  @Public()
  @Get('districts/:district/units')
  @ApiOperation({ summary: 'Upazilas, thanas and circles of one district' })
  @ApiResponse({ status: HttpStatus.OK, type: [GeoUnitDto] })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  listUnits(@Param('district') district: string): GeoUnitDto[] {
    try {
      return unwrapOrThrow(this.geoService.listUnits(district));
    } catch (error) {
      this.logger.error({ err: error, district }, 'Exception occurred in GeoController.listUnits');
      throw error;
    }
  }

  @Public()
  @Get('districts/:district/units/:unit/areas')
  @ApiOperation({ summary: 'Areas of one upazila or thana' })
  @ApiResponse({ status: HttpStatus.OK, type: GeoAreaListDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  listAreas(@Param('district') district: string, @Param('unit') unit: string): GeoAreaListDto {
    try {
      return unwrapOrThrow(this.geoService.listAreas(district, unit));
    } catch (error) {
      this.logger.error(
        { err: error, district, unit },
        'Exception occurred in GeoController.listAreas',
      );
      throw error;
    }
  }

  @Public()
  @Get('search')
  @ApiOperation({ summary: 'Search places for the map pin' })
  @ApiResponse({ status: HttpStatus.OK, type: [GeocodedPlaceDto] })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Map search disabled or unreachable',
  })
  async search(@Query() query: GeoSearchQueryDto): Promise<GeocodedPlaceDto[]> {
    try {
      return unwrapOrThrow(await this.geoService.searchPlaces(query));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in GeoController.search');
      throw error;
    }
  }

  @Public()
  @Get('reverse')
  @ApiOperation({ summary: 'Reverse-geocode a dropped pin' })
  @ApiResponse({ status: HttpStatus.OK, type: GeocodedPlaceDto })
  @ApiResponse({ status: HttpStatus.SERVICE_UNAVAILABLE })
  async reverse(@Query() query: GeoReverseQueryDto): Promise<GeocodedPlaceDto> {
    try {
      return unwrapOrThrow(await this.geoService.reverseGeocode(query));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in GeoController.reverse');
      throw error;
    }
  }
}
