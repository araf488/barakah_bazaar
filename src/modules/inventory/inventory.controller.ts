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
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { UserRole } from '../../infra/prisma/prisma-client';
import {
  AdjustStockDto,
  ReceiveStockDto,
  StockLineDto,
  StockMovementDto,
  StockQueryDto,
} from './dto/inventory.dto';
import { InventoryConstants } from './inventory.constants';
import { InventoryService } from './inventory.service';
import { WarehouseService } from './warehouse.service';
import {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  WarehouseDto,
  WarehouseLifecycleDto,
  WarehouseQueryDto,
} from './dto/warehouse.dto';

/**
 * Warehouse stock.
 *
 * `SUPER_ADMIN` and `WAREHOUSE` — the first role in this codebase that WAREHOUSE actually
 * holds. MARKETING can rewrite a price but must not be able to invent stock, and OPS runs
 * orders rather than shelves; a stock adjustment is an inventory write-off, which is money.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN, UserRole.WAREHOUSE)
@Controller(InventoryConstants.RouteBase)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly warehouseService: WarehouseService,
    @InjectPinoLogger(InventoryController.name) private readonly logger: PinoLogger,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Stock levels, lowest first' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto })
  async list(@Query() query: StockQueryDto): Promise<PaginatedResponseDto<StockLineDto>> {
    try {
      return unwrapOrThrow(await this.inventoryService.listStock(query));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in InventoryController.list');
      throw error;
    }
  }

  @Post('receipts')
  @ApiOperation({ summary: 'Book a delivery into a warehouse' })
  @ApiResponse({ status: HttpStatus.CREATED, type: StockMovementDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Missing or past expiry' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'The hub cannot store this condition, or is out of service',
  })
  async receive(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: ReceiveStockDto,
  ): Promise<StockMovementDto> {
    try {
      return unwrapOrThrow(
        await this.inventoryService.receiveStock(InventoryController.require(user), dto),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in InventoryController.receive');
      throw error;
    }
  }

  @Post('adjustments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Correct a stock count, with a reason' })
  @ApiResponse({ status: HttpStatus.OK, type: StockLineDto })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Would go below zero or eat reserved stock',
  })
  async adjust(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: AdjustStockDto,
  ): Promise<StockLineDto> {
    try {
      return unwrapOrThrow(
        await this.inventoryService.adjustStock(InventoryController.require(user), dto),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in InventoryController.adjust');
      throw error;
    }
  }

  @Get('warehouses/:warehouseId/variants/:variantId/movements')
  @ApiOperation({ summary: 'The stock ledger for one line' })
  @ApiResponse({ status: HttpStatus.OK, type: [StockMovementDto] })
  async movements(
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ): Promise<StockMovementDto[]> {
    try {
      return unwrapOrThrow(await this.inventoryService.listMovements(warehouseId, variantId));
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId, variantId },
        'Exception occurred in InventoryController.movements',
      );
      throw error;
    }
  }

  // ── Warehouses ────────────────────────────────────────────────────────────

  @Get('warehouses')
  @ApiOperation({ summary: 'Hubs stock can sit in' })
  @ApiResponse({ status: HttpStatus.OK, type: [WarehouseDto] })
  async listWarehouses(@Query() query: WarehouseQueryDto): Promise<WarehouseDto[]> {
    try {
      return unwrapOrThrow(await this.warehouseService.listWarehouses(query));
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in InventoryController.listWarehouses');
      throw error;
    }
  }

  /**
   * Opening, editing and retiring hubs belongs to WAREHOUSE as well as SUPER_ADMIN — the
   * people who run the hubs own their lifecycle. Deactivation refuses a hub holding stock, the
   * last active hub and the last active cold-capable hub; see
   * `WarehouseService.deactivateWarehouse`.
   */
  @Post('warehouses')
  @ApiOperation({ summary: 'Open a warehouse' })
  @ApiResponse({ status: HttpStatus.CREATED, type: WarehouseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Code already in use' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Address is not a real place' })
  async createWarehouse(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateWarehouseDto,
  ): Promise<WarehouseDto> {
    try {
      return unwrapOrThrow(
        await this.warehouseService.createWarehouse(InventoryController.require(user), dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error },
        'Exception occurred in InventoryController.createWarehouse',
      );
      throw error;
    }
  }

  @Patch('warehouses/:id')
  @ApiOperation({ summary: 'Edit a warehouse' })
  @ApiResponse({ status: HttpStatus.OK, type: WarehouseDto })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'Code already in use, or the edit drops CHILLED or FROZEN from the last active hub that holds it',
  })
  async updateWarehouse(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
  ): Promise<WarehouseDto> {
    try {
      return unwrapOrThrow(
        await this.warehouseService.updateWarehouse(InventoryController.require(user), id, dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId: id },
        'Exception occurred in InventoryController.updateWarehouse',
      );
      throw error;
    }
  }

  @Patch('warehouses/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Take a hub out of service',
    description: 'Idempotent: an already-inactive hub answers 200 and writes no audit row.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: WarehouseLifecycleDto })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'Still holds stock, is the last active hub, or is the last active hub able to hold CHILLED or FROZEN goods',
  })
  async deactivateWarehouse(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WarehouseLifecycleDto> {
    try {
      return unwrapOrThrow(
        await this.warehouseService.deactivateWarehouse(InventoryController.require(user), id),
      );
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId: id },
        'Exception occurred in InventoryController.deactivateWarehouse',
      );
      throw error;
    }
  }

  @Patch('warehouses/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Put a hub back into service',
    description: 'Idempotent: an already-active hub answers 200 and writes no audit row.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: WarehouseLifecycleDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such hub' })
  async reactivateWarehouse(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WarehouseLifecycleDto> {
    try {
      return unwrapOrThrow(
        await this.warehouseService.reactivateWarehouse(InventoryController.require(user), id),
      );
    } catch (error) {
      this.logger.error(
        { err: error, warehouseId: id },
        'Exception occurred in InventoryController.reactivateWarehouse',
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
