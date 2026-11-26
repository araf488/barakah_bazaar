import { type CallerContext, callApi, callApiExplained } from '../auth/api';

// The staff-only parts of the API's auth surface (src/modules/auth/auth.controller.ts and
// src/modules/admin/staff-invitation.controller.ts). Sign-in, refresh and sign-out are the same
// calls the storefront makes (`authApi`).

export interface MfaSetup {
  /** Base32, for typing into an authenticator by hand. */
  secret: string;
  /** Rendered as a QR code in the browser; never sent to any other service. */
  otpauthUri: string;
}

export interface InvitationAcceptance {
  token: string;
  password: string;
  fullName: string;
}

export const staffApi = {
  /** Starts (or restarts) authenticator setup for a staff member who has none yet. */
  mfaSetup: (caller: CallerContext, enrolmentToken: string) =>
    callApi<MfaSetup>('POST', '/auth/mfa/setup', caller, { enrolmentToken }),
  /** Confirms setup with a first code. Answers recovery codes, never a session. */
  mfaEnable: (caller: CallerContext, enrolmentToken: string, code: string) =>
    callApi<{ recoveryCodes: string[] }>('POST', '/auth/mfa/enable', caller, {
      enrolmentToken,
      code,
    }),
  /** Keeps the refusal's message, so a weak password names the rule it broke. */
  acceptInvitation: (caller: CallerContext, input: InvitationAcceptance) =>
    callApiExplained<{ accepted: boolean }>('POST', '/staff/invitations/accept', caller, input),
};
