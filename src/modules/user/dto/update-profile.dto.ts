import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TrimString } from '../../../common/dto/trim.decorator';
import { UserConstants } from '../user.constants';

/**
 * The editable half of a profile.
 *
 * `email` and `phone` are mirrored from the Supabase token on every `/auth/me` call, so
 * writing them here would be undone by the caller's next request; changing them is an Auth
 * operation, not a profile one.
 */
export class UpdateProfileDto {
  @ApiProperty({ maxLength: UserConstants.MaxFullNameLength, example: 'Rahim Uddin' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxFullNameLength)
  fullName!: string;
}
