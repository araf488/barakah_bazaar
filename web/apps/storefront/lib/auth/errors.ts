import { UNREACHABLE_STATUS } from './api';

/** Message keys under `auth.errors`, one per way an auth call can be refused. */
export type AuthErrorKey =
  'invalid' | 'credentials' | 'blocked' | 'code' | 'expired' | 'tooMany' | 'unavailable';

const STATUS_TO_ERROR: Readonly<Record<number, AuthErrorKey>> = {
  400: 'invalid',
  401: 'credentials',
  403: 'blocked',
  404: 'expired',
  409: 'invalid',
  410: 'expired',
  429: 'tooMany',
  [UNREACHABLE_STATUS]: 'unavailable',
};

/**
 * Maps a refused auth call to the message the visitor sees. The API's own English messages are
 * never shown: they are not localized, and the enumeration-safe ones are deliberately vague.
 */
export const authErrorFor = (status: number): AuthErrorKey =>
  STATUS_TO_ERROR[status] ?? 'unavailable';
