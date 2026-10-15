import { formatMessage } from '../../../common/constants/error-messages.constants';
import { AuthConstants, AuthMessages } from '../auth.constants';

/** Token lifetimes and identity policy, resolved from the database with validated fallbacks. */
export interface ResolvedAuthSettings {
  readonly accessTokenMinutes: number;
  readonly customerRefreshIdleMinutes: number;
  readonly customerRefreshAbsoluteMinutes: number;
  readonly staffRefreshIdleMinutes: number;
  readonly staffRefreshAbsoluteMinutes: number;
  readonly staffMfaRequired: boolean;
  readonly emailVerificationGraceHours: number;
  readonly refreshReuseGraceSeconds: number;
}

/** Mirrors the Prisma `AuthSettings` model's `@default`s exactly. */
export const AUTH_SETTINGS_DEFAULTS: ResolvedAuthSettings = Object.freeze({
  accessTokenMinutes: 30,
  customerRefreshIdleMinutes: 43200,
  customerRefreshAbsoluteMinutes: 129600,
  staffRefreshIdleMinutes: 720,
  staffRefreshAbsoluteMinutes: 10080,
  staffMfaRequired: true,
  emailVerificationGraceHours: 168,
  refreshReuseGraceSeconds: 30,
});

export type AuthSettingsField = keyof ResolvedAuthSettings;

/** One rule a candidate settings value broke, with the message a caller can show. */
export interface AuthSettingsViolation {
  readonly field: AuthSettingsField;
  readonly message: string;
}

type Resolved = Partial<ResolvedAuthSettings>;

interface FieldRule {
  readonly isValid: (value: unknown, resolved: Resolved) => boolean;
  readonly message: (field: AuthSettingsField, resolved: Resolved) => string;
}

/**
 * The order every field is checked in, and the order the read path resolves them in.
 * `accessTokenMinutes` comes first and each idle window before its absolute cap, because each
 * later rule is checked against the *already-resolved* value of the one it depends on.
 */
export const AUTH_SETTINGS_FIELD_ORDER: readonly AuthSettingsField[] = Object.freeze([
  'accessTokenMinutes',
  'customerRefreshIdleMinutes',
  'staffRefreshIdleMinutes',
  'customerRefreshAbsoluteMinutes',
  'staffRefreshAbsoluteMinutes',
  'emailVerificationGraceHours',
  'refreshReuseGraceSeconds',
  'staffMfaRequired',
]);

/**
 * A dependency's resolved value, or `NaN` when it has not been resolved — every comparison
 * against `NaN` is false, so a dependent field is refused rather than checked against nothing.
 */
const dependency = (resolved: Resolved, field: AuthSettingsField): number => {
  const value = resolved[field];
  return typeof value === 'number' ? value : Number.NaN;
};

const integerInRange = (min: number, max: number): FieldRule => ({
  isValid: (value) =>
    Number.isInteger(value) && (value as number) >= min && (value as number) <= max,
  message: (field) =>
    formatMessage(AuthMessages.SettingsIntegerRangeTemplate, field, String(min), String(max)),
});

const integerGreaterThan = (other: AuthSettingsField): FieldRule => ({
  isValid: (value, resolved) =>
    Number.isInteger(value) && (value as number) > dependency(resolved, other),
  message: (field, resolved) =>
    formatMessage(
      AuthMessages.SettingsGreaterThanTemplate,
      field,
      other,
      String(dependency(resolved, other)),
    ),
});

const integerAtLeast = (other: AuthSettingsField): FieldRule => ({
  isValid: (value, resolved) =>
    Number.isInteger(value) && (value as number) >= dependency(resolved, other),
  message: (field, resolved) =>
    formatMessage(
      AuthMessages.SettingsAtLeastTemplate,
      field,
      other,
      String(dependency(resolved, other)),
    ),
});

const boolean: FieldRule = {
  isValid: (value) => typeof value === 'boolean',
  message: (field) => formatMessage(AuthMessages.SettingsBooleanTemplate, field),
};

/**
 * One rule per field — the single definition both the read path (`AuthSettingsService`, which
 * falls back per field) and the write path (which refuses the whole candidate) check against,
 * so the two can never disagree about what a valid setting is.
 */
const RULES: Readonly<Record<AuthSettingsField, FieldRule>> = Object.freeze({
  accessTokenMinutes: integerInRange(
    AuthConstants.AccessTokenMinMinutes,
    AuthConstants.AccessTokenMaxMinutes,
  ),
  customerRefreshIdleMinutes: integerGreaterThan('accessTokenMinutes'),
  staffRefreshIdleMinutes: integerGreaterThan('accessTokenMinutes'),
  customerRefreshAbsoluteMinutes: integerAtLeast('customerRefreshIdleMinutes'),
  staffRefreshAbsoluteMinutes: integerAtLeast('staffRefreshIdleMinutes'),
  emailVerificationGraceHours: integerInRange(0, AuthConstants.EmailVerificationGraceMaxHours),
  refreshReuseGraceSeconds: integerInRange(0, AuthConstants.RefreshReuseGraceMaxSeconds),
  staffMfaRequired: boolean,
});

/** One field's own rule given already-resolved dependencies — what the read path uses per field. */
export function isFieldValid(
  field: AuthSettingsField,
  value: unknown,
  resolved: Resolved,
): boolean {
  return RULES[field].isValid(value, resolved);
}

/**
 * Every rule, checked against the candidate as a whole. Empty array = valid.
 *
 * Dependent fields are checked against the candidate's own values, so a combination such as
 * `accessTokenMinutes: 60, staffRefreshIdleMinutes: 45` reports one violation, on the idle
 * window — the access-token life is itself valid.
 */
export function checkAuthSettings(candidate: ResolvedAuthSettings): AuthSettingsViolation[] {
  return AUTH_SETTINGS_FIELD_ORDER.filter(
    (field) => !RULES[field].isValid(candidate[field], candidate),
  ).map((field) => ({ field, message: RULES[field].message(field, candidate) }));
}
