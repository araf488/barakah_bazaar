import { Transform } from 'class-transformer';

/**
 * Trims a string payload field before validation runs.
 *
 * Applied to every free-text DTO field, so `"   "` becomes `""` and is then
 * caught by `@IsNotEmpty` rather than being stored as a blank recipient name.
 * Non-strings pass through untouched — validation, not this decorator, is what
 * rejects a number sent where text was expected.
 */
export const TrimString = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
