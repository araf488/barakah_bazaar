import { BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { AuthConstants, AuthMessages } from './auth.constants';

/**
 * The caller's declared device id, required on every route that mints or refreshes a
 * session. Mirrors `SessionAuthGuard`'s own reading of the header, but this is a 400 —
 * malformed input — rather than the guard's 401, since no credential has been checked yet.
 */
export const requireDeviceId = (request: Request): string => {
  const value = request.headers[AuthConstants.DeviceIdHeader] as string | undefined;

  if (!value || value.length > AuthConstants.DeviceIdMaxLength) {
    throw new BadRequestException(AuthMessages.DeviceIdRequired);
  }

  return value;
};

/** The caller's `User-Agent`, or `null` when absent. */
export const userAgentOf = (request: Request): string | null => {
  const value = request.headers['user-agent'];
  return typeof value === 'string' ? value : null;
};
