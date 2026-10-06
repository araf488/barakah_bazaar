import { EmailMessage } from '../../notification/ports/email-sender.port';
import { PlainEmailInput, SHOP, escapeHtml, firstName, greeting, shell } from './email-layout';

export type { PlainEmailInput } from './email-layout';

/** Everything a verification email needs. */
export interface VerificationEmailInput {
  readonly to: string;
  readonly fullName: string;
  readonly link: string;
  readonly code: string;
  readonly ttlHours: number;
}

/**
 * The verification email: a link **and** a code, deliberately both.
 *
 * With no registered domain the mail cannot align SPF or DKIM, so a share of it lands in spam —
 * and a link clicked out of a spam folder on a phone may not resolve at all, while six digits
 * read off the screen always work.
 */
export const buildVerificationEmail = (input: VerificationEmailInput): EmailMessage => ({
  to: input.to,
  subject: `Verify your ${SHOP} email address`,
  body: `${greeting(firstName(input.fullName))}

Confirm your email address to finish setting up your ${SHOP} account.

Open this link:
${input.link}

Or enter this code in the app:
${input.code}

Either one works. Both stop working in ${input.ttlHours} hours.

If you did not create a ${SHOP} account, you can ignore this message — nothing was activated.
`,
  html: shell(
    'Confirm your address',
    `<tr><td style="padding:24px 40px 8px;">
       <p style="font-size:15px;margin:0 0 16px;">${greeting(escapeHtml(firstName(input.fullName)))}</p>
       <p style="font-size:15px;margin:0 0 24px;">Confirm your email address to finish setting up your ${SHOP} account.</p>
       <p style="text-align:center;margin:0 0 24px;">
         <a href="${input.link}" style="background:#1f7a4c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;border-radius:10px;padding:14px 32px;display:inline-block;">Confirm my address</a>
       </p>
       <p style="font-size:14px;color:#52606d;margin:0 0 8px;text-align:center;">Or enter this code in the app:</p>
       <div style="background:#f0f5f2;border-radius:12px;padding:20px;text-align:center;margin:0 0 24px;">
         <span style="font-size:34px;font-weight:900;letter-spacing:10px;color:#1f7a4c;">${input.code}</span>
       </div>
       <p style="font-size:13px;color:#7b8794;margin:0 0 8px;">Either one works. Both stop working in ${input.ttlHours} hours.</p>
       <p style="font-size:13px;color:#9aa5b1;margin:0 0 24px;">If you did not create a ${SHOP} account, you can ignore this message — nothing was activated.</p>
     </td></tr>`,
  ),
});

/**
 * Sent when registration is attempted against an address that already has an account.
 *
 * Carries **no token, no code and no link**. Whoever triggered this may not be the account
 * owner, and this email is the only thing they get — it must hand them nothing usable.
 */
export const buildAlreadyRegisteredEmail = (input: PlainEmailInput): EmailMessage => ({
  to: input.to,
  subject: `You already have a ${SHOP} account`,
  body: `${greeting(firstName(input.fullName))}

Someone tried to create a ${SHOP} account with this email address, and one already exists.

No new account was created and nothing about your existing account changed.

If this was you, sign in with your usual password. If you have forgotten it, use the
"forgot password" option on the sign-in screen.

If this was not you, no action is needed — whoever it was learned nothing about your account.
`,
  html: shell(
    'Account already exists',
    `<tr><td style="padding:24px 40px 32px;">
       <p style="font-size:15px;margin:0 0 16px;">${greeting(escapeHtml(firstName(input.fullName)))}</p>
       <p style="font-size:15px;margin:0 0 16px;">Someone tried to create a ${SHOP} account with this email address, and one already exists.</p>
       <p style="font-size:15px;margin:0 0 16px;">No new account was created and nothing about your existing account changed.</p>
       <p style="font-size:14px;color:#52606d;margin:0 0 8px;">If this was you, sign in with your usual password. If you have forgotten it, use the &ldquo;forgot password&rdquo; option on the sign-in screen.</p>
       <p style="font-size:13px;color:#9aa5b1;margin:0;">If this was not you, no action is needed — whoever it was learned nothing about your account.</p>
     </td></tr>`,
  ),
});

/** Sent once an address is verified. A confirmation, nothing more. */
export const buildVerifiedEmail = (input: PlainEmailInput): EmailMessage => ({
  to: input.to,
  subject: `Your ${SHOP} email address is confirmed`,
  body: `${greeting(firstName(input.fullName))}

Your email address is confirmed. Your ${SHOP} account is fully set up.

If you did not do this, reply to this message.
`,
  html: shell(
    'Address confirmed',
    `<tr><td style="padding:24px 40px 32px;">
       <p style="font-size:15px;margin:0 0 16px;">${greeting(escapeHtml(firstName(input.fullName)))}</p>
       <p style="font-size:15px;margin:0 0 16px;">Your email address is confirmed. Your ${SHOP} account is fully set up.</p>
       <p style="font-size:13px;color:#9aa5b1;margin:0;">If you did not do this, reply to this message.</p>
     </td></tr>`,
  ),
});
