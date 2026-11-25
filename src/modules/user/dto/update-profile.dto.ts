import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TrimString } from '../../../common/dto/trim.decorator';
import { UserConstants } from '../user.constants';

/**
 * The editable half of a profile.
 *
 * `email` and `phone` are credentials — one signs in, the other receives an OTP — so
 * changing either is an authentication operation with its own verification step, not a
 * profile edit.
 */
export class UpdateProfileDto {
  @ApiProperty({ maxLength: UserConstants.MaxFullNameLength, example: 'Rahim Uddin' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(UserConstants.MaxFullNameLength)
  fullName!: string;
}
