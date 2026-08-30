import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { unwrapOrThrow } from '../../common/types/service-response';
import { NotificationConstants } from './notification.constants';
import { NotificationService } from './notification.service';
import { NotificationListDto, NotificationQueryDto } from './dto/notification.dto';

/**
 * The customer's own message history.
 *
 * Read-only, and scoped to the caller by their token rather than by any id in the path — the
 * same reasoning as the cart: nothing here can be enumerated. Sending is never triggered over
 * HTTP; messages are a consequence of a business event, not a request.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller(NotificationConstants.RouteBase)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: "List the signed-in customer's transactional messages" })
  @ApiResponse({ status: 200, type: NotificationListDto })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationQueryDto,
  ): Promise<NotificationListDto> {
    return unwrapOrThrow(await this.notificationService.listMine(user, query));
  }
}
