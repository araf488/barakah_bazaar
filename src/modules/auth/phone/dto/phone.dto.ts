import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { TrimString } from '../../../../common/dto/trim.decorator';
import { BANGLADESH_MOBILE_PATTERN } from '../../../../common/phone/bangladesh-phone';

/** The six digits of a phone code; leading zeros are valid. */
const PHONE_CODE_PATTERN = /^\d{6}$/;

/** `POST /auth/phone/verification`'s request body. */
export class PhoneRequestDto {
  @ApiProperty({ example: '01712345678', description: 'Bangladeshi mobile, local or +880 form.' })
  @TrimString()
  @IsString()
  @Matches(BANGLADESH_MOBILE_PATTERN, { message: 'phone must be a Bangladeshi mobile number' })
  phone!: string;
}

/** `POST /auth/phone/verification/confirm`'s request body. */
export class PhoneConfirmDto extends PhoneRequestDto {
  @ApiProperty({ example: '012345', description: '6-digit code from the text message.' })
  @IsString()
  @Matches(PHONE_CODE_PATTERN, { message: 'code must be a 6-digit numeric code' })
  code!: string;
}

/** What a code request answers with. The code itself is never in a response. */
export class PhoneCodeSentDto {
  @ApiProperty({ example: 300 })
  expiresInSeconds!: number;

  @ApiProperty({ example: 60 })
  resendAfterSeconds!: number;
}

/** What a successful confirmation answers with. */
export class PhoneVerifiedDto {
  @ApiProperty({ example: '+8801712345678' })
  phone!: string;

  @ApiProperty({ example: true })
  phoneVerified!: true;
}
