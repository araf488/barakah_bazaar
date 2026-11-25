import { ValidationArguments, ValidationOptions, registerDecorator } from 'class-validator';

/** Registered constraint name recorded in `ValidationError.constraints`, unless overridden. */
const DEFAULT_CONSTRAINT_NAME = 'isExactlyOneOf';

/**
 * Options accepted by `IsExactlyOneOf`, on top of the usual class-validator ones.
 */
export interface IsExactlyOneOfOptions extends ValidationOptions {
  /**
   * Overrides the name class-validator records this constraint under, in
   * `ValidationError.constraints`. Defaults to `'isExactlyOneOf'`. Set this when an existing
   * caller already asserts on a specific constraint key and must keep doing so.
   */
  constraintName?: string;
}

/**
 * Exactly one of the named `fields` must be present on the object being validated.
 *
 * Attach it to a field other than the ones it guards — typically one that is always required
 * and carries no `@IsOptional()` of its own — rather than to any of `fields` themselves:
 * `@IsOptional()` on a field skips *every* validator declared on that same property whenever
 * the value it guards is absent — including a cross-field check placed there — which is
 * exactly the "none provided" case this decorator exists to catch. A property with no such
 * guard always runs it.
 */
export function IsExactlyOneOf(
  fields: readonly string[],
  options?: IsExactlyOneOfOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: options?.constraintName ?? DEFAULT_CONSTRAINT_NAME,
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const target = args.object as Record<string, unknown>;
          const provided = fields
            .map((field) => target[field])
            .filter((value) => value !== undefined && value !== null && value !== '');
          return provided.length === 1;
        },
        defaultMessage(): string {
          return `Provide exactly one of ${fields.join(' or ')}`;
        },
      },
    });
  };
}
