import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One live session in "where am I signed in" (`GET /auth/sessions`).
 *
 * Built field by field in `AuthMapper.toSessionSummary` rather than by spreading the Prisma
 * row, so `refreshTokenHash` / `previousRefreshTokenHash` — the two columns that could
 * authenticate as this session — can never leak into a response by accident, including one
 * added to the table later. `ipAddress` is truncated before it ever reaches this DTO.
 */
export class SessionSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Client-generated install id this session is bound to.' })
  deviceId!: string;

  @ApiPropertyOptional({ nullable: true })
  userAgent!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Truncated: IPv4 loses its last octet (a /24), IPv6 keeps only its first four groups ' +
      '(a /64) with the rest rendered as "::", and an address this API cannot classify is ' +
      'redacted to null rather than emitted whole.',
  })
  ipAddress!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({ nullable: true, description: 'Null until the session is first used.' })
  lastUsedAt!: Date | null;

  @ApiProperty({ description: 'True for the one session the caller is making this request with.' })
  current!: boolean;
}

/** What `POST /auth/logout-all` returns. */
export class LogoutAllResponseDto {
  @ApiProperty({ description: 'How many live sessions were ended.' })
  revoked!: number;
}
