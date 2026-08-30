import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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

  private static require(user: AuthenticatedUser | undefined): AuthenticatedUser {
    if (!user) {
      throw new UnauthorizedException(ErrorMessages.MissingAccessToken);
    }
    return user;
  }
}
