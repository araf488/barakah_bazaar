import { EmailMessage } from '../../notification/ports/email-sender.port';

/** Everything a verification email needs. */
export interface VerificationEmailInput {
  readonly to: string;
  readonly fullName: string;
  readonly link: string;
  readonly code: string;
  readonly ttlHours: number;
}

/** Everything the credential-free emails need. */
export interface PlainEmailInput {
  readonly to: string;
  readonly fullName: string;
}

const SHOP = 'Barakah Bazaar';

/** First name only: "Dear Aisha Rahman" reads like a form letter. Empty when no name is given. */
const firstName = (fullName: string): string => fullName.trim().split(' ')[0] ?? '';

/**
 * "Hello Name," when a name is given, otherwise plain "Hello," — never invents one.
 *
 * "Dear Friend" / "Hello Friend" is a phrase spam classifiers weight, and this application
 * sends from a verified address with no registered domain, so it cannot align SPF or DKIM and
 * already lands in spam more than it should. Inventing a filler name only makes that worse.
 * The name must move with the comma: `Hello ${name},` on an empty name would leave "Hello ,".
 */
const greeting = (name: string): string => (name ? `Hello ${name},` : 'Hello,');

/** Escape HTML special characters. & must be escaped first to avoid double-encoding. */
const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const shell = (heading: string, inner: string): string => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4e7eb;">
        <tr><td style="padding:32px 40px 8px;text-align:center;">
          <div style="font-size:26px;font-weight:800;color:#1f7a4c;">${SHOP}</div>
          <div style="font-size:13px;color:#7b8794;letter-spacing:1px;text-transform:uppercase;">${heading}</div>
        </td></tr>
        ${inner}
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
