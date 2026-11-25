import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages } from '../../common/constants/error-messages.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { AddressService } from './address.service';
import { AddressDto } from './dto/address-response.dto';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { UserConstants } from './user.constants';

/**
 * The caller's own delivery addresses.
 *
 * Separate from UserController because an address book is a different resource from a
 * profile — one controller for both is the shape S6960 flags.
 *
 * `:id` is parsed as a UUID, so a malformed id is 400 and a well-formed id belonging to
 * somebody else is 404 — never their data.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller(UserConstants.AddressRouteBase)
export class AddressController {
  constructor(
    private readonly addressService: AddressService,
    @InjectPinoLogger(AddressController.name) private readonly logger: PinoLogger,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List saved addresses, default first then newest' })
  @ApiResponse({ status: HttpStatus.OK, type: [AddressDto] })
  async list(@CurrentUser() user: AuthenticatedUser | undefined): Promise<AddressDto[]> {
    try {
      return unwrapOrThrow(
        await this.addressService.listAddresses(AddressController.require(user)),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AddressController.list');
      throw error;
    }
  }

  @Post()
  @ApiOperation({ summary: 'Save a new address' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AddressDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Validation or geography failure' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Address cap reached' })
  async create(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateAddressDto,
  ): Promise<AddressDto> {
    try {
      return unwrapOrThrow(
        await this.addressService.createAddress(AddressController.require(user), dto),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AddressController.create');
      throw error;
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'One saved address' })
  @ApiResponse({ status: HttpStatus.OK, type: AddressDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  async get(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AddressDto> {
    try {
      return unwrapOrThrow(
        await this.addressService.getAddress(AddressController.require(user), id),
      );
    } catch (error) {
      this.logger.error(
        { err: error, addressId: id },
        'Exception occurred in AddressController.get',
      );
      throw error;
    }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a saved address' })
  @ApiResponse({ status: HttpStatus.OK, type: AddressDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  async update(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressDto> {
    try {
      return unwrapOrThrow(
        await this.addressService.updateAddress(AddressController.require(user), id, dto),
      );
    } catch (error) {
      this.logger.error(
        { err: error, addressId: id },
        'Exception occurred in AddressController.update',
      );
      throw error;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a saved address' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  async remove(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    try {
      unwrapOrThrow(await this.addressService.deleteAddress(AddressController.require(user), id));
    } catch (error) {
      this.logger.error(
        { err: error, addressId: id },
        'Exception occurred in AddressController.remove',
      );
      throw error;
    }
  }

  /** PUT, not POST: promoting the address that is already default changes nothing. */
  @Put(':id/default')
  @ApiOperation({ summary: 'Make this the default delivery address' })
  @ApiResponse({ status: HttpStatus.OK, type: AddressDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  async setDefault(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AddressDto> {
    try {
      return unwrapOrThrow(
        await this.addressService.setDefaultAddress(AddressController.require(user), id),
      );
    } catch (error) {
      this.logger.error(
        { err: error, addressId: id },
        'Exception occurred in AddressController.setDefault',
      );
      throw error;
    }
  }

  /**
   * `@CurrentUser()` is undefined only on `@Public()` routes; none of these are, so this is
   * a guard-order safety net rather than an expected path.
   */
  private static require(user: AuthenticatedUser | undefined): AuthenticatedUser {
    if (!user) {
      throw new UnauthorizedException(ErrorMessages.MissingAccessToken);
    }
    return user;
  }
}
