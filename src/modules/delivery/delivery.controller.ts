import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { UserRole } from '../../infra/prisma/prisma-client';
import { AdminDeliveryService } from './admin-delivery.service';
import { DeliveryConstants } from './delivery.constants';
import { DeliveryService } from './delivery.service';
import { DeliveryQuoteDto, DeliveryZoneDto, UpsertZoneDto } from './dto/delivery.dto';
import { QuoteDeliveryDto } from './dto/quote-delivery.dto';

/**
 * What delivery costs, for the storefront.
 *
 * A quote is advisory: checkout resolves the fee again server-side from the address actually
 * ordered to. This endpoint exists so the basket can show a number before the customer
 * commits, not so the client can tell the server what to charge.
 */
@ApiTags('Delivery')
@ApiBearerAuth()
@Controller(DeliveryConstants.RouteBase)
export class DeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
    @InjectPinoLogger(DeliveryController.name) private readonly logger: PinoLogger,
  ) {}

  @Post('quote')
  @ApiOperation({ summary: 'What delivery would cost to a destination, for a basket value' })
  @ApiResponse({ status: HttpStatus.CREATED, type: DeliveryQuoteDto })
  async quote(@Body() dto: QuoteDeliveryDto): Promise<DeliveryQuoteDto> {
    try {
      return unwrapOrThrow(
        await this.delivery.quote(
          { division: dto.division, district: dto.district, unit: dto.unit },
          BigInt(dto.subtotalPoysha),
        ),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in DeliveryController.quote');
      throw error;
    }
  }
}

/**
 * Delivery pricing management.
 *
 * `SUPER_ADMIN` and `OPS`: pricing is money, and OPS is the role that runs fulfilment.
 * WAREHOUSE moves stock and MARKETING does not set what customers are charged to receive it.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN, UserRole.OPS)
@Controller(DeliveryConstants.AdminRouteBase)
export class AdminDeliveryController {
  constructor(
    private readonly zones: AdminDeliveryService,
    @InjectPinoLogger(AdminDeliveryController.name) private readonly logger: PinoLogger,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Delivery zones and their rules' })
  @ApiResponse({ status: HttpStatus.OK, type: [DeliveryZoneDto] })
  async list(@Query('activeOnly') activeOnly?: string): Promise<DeliveryZoneDto[]> {
    try {
      return unwrapOrThrow(await this.zones.list(activeOnly === 'true'));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminDeliveryController.list');
      throw error;
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a delivery zone' })
  @ApiResponse({ status: HttpStatus.CREATED, type: DeliveryZoneDto })
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpsertZoneDto,
  ): Promise<DeliveryZoneDto> {
    try {
      return unwrapOrThrow(await this.zones.create(actor, dto));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminDeliveryController.create');
      throw error;
    }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a delivery zone, replacing its whole rule set' })
  @ApiResponse({ status: HttpStatus.OK, type: DeliveryZoneDto })
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertZoneDto,
  ): Promise<DeliveryZoneDto> {
    try {
      return unwrapOrThrow(await this.zones.update(actor, id, dto));
    } catch (error) {
      this.logger.error(
        { err: error, zoneId: id },
        'Exception occurred in AdminDeliveryController.update',
      );
      throw error;
    }
  }
}
