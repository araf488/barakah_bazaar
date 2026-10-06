import { EmailMessage } from '../../notification/ports/email-sender.port';
import { PlainEmailInput, SHOP, escapeHtml, firstName, greeting, shell } from './email-layout';

/** Everything a reset email needs. */
export interface PasswordResetEmailInput {
  readonly to: string;
  readonly fullName: string;
  readonly link: string;
  readonly code: string;
  readonly ttlMinutes: number;
}

/**
 * The reset email: a link **and** a code, as the verification email does.
 *
 * This matters more here than there. With no registered domain a share of this mail lands in
 * spam, where a link on a phone may not resolve, but six digits read off the screen always
 * work. And this credential lives an hour, not a day.
 *
 * The plain-text lines "Open this link:" and "Or enter this code in the app:" are relied on by
 * the e2e fixtures that read the credential back out. Keep them.
 */
export const buildPasswordResetEmail = (input: PasswordResetEmailInput): EmailMessage => ({
  to: input.to,
  subject: `Reset your ${SHOP} password`,
  body: `${greeting(firstName(input.fullName))}

Someone asked to reset the password for your ${SHOP} account.

Open this link:
${input.link}

Or enter this code in the app:
${input.code}

Either one works. Both stop working in ${input.ttlMinutes} minutes, and only the newest reset email you received will work.

If you did not ask for this, ignore this message. Your password has not changed, and it cannot be changed without this email.
`,
  html: shell(
    'Reset your password',
    `<tr><td style="padding:24px 40px 8px;">
       <p style="font-size:15px;margin:0 0 16px;">${greeting(escapeHtml(firstName(input.fullName)))}</p>
       <p style="font-size:15px;margin:0 0 24px;">Someone asked to reset the password for your ${SHOP} account.</p>
       <p style="text-align:center;margin:0 0 24px;">
         <a href="${input.link}" style="background:#1f7a4c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;border-radius:10px;padding:14px 32px;display:inline-block;">Choose a new password</a>
       </p>
       <p style="font-size:14px;color:#52606d;margin:0 0 8px;text-align:center;">Or enter this code in the app:</p>
       <div style="background:#f0f5f2;border-radius:12px;padding:20px;text-align:center;margin:0 0 24px;">
         <span style="font-size:34px;font-weight:900;letter-spacing:10px;color:#1f7a4c;">${input.code}</span>
       </div>
       <p style="font-size:13px;color:#7b8794;margin:0 0 8px;">Either one works. Both stop working in ${input.ttlMinutes} minutes, and only the newest reset email you received will work.</p>
       <p style="font-size:13px;color:#9aa5b1;margin:0 0 24px;">If you did not ask for this, ignore this message. Your password has not changed, and it cannot be changed without this email.</p>
     </td></tr>`,
  ),
});

/**
 * Sent after a password is changed, by a reset or by the signed-in change route.
 *
 * Carries **no token, no code and no link**. If the owner did not make this change, this email
 * is how they find out. It must tell them what to do without handing anything to whoever did.
 */
export const buildPasswordChangedEmail = (input: PlainEmailInput): EmailMessage => ({
  to: input.to,
  subject: `Your ${SHOP} password was changed`,
  body: `${greeting(firstName(input.fullName))}

The password for your ${SHOP} account was just changed. If you were signed in on other devices, they have been signed out.

If this was you, there is nothing more to do.

If this was not you, reset your password straight away with the "forgot password" option on the sign-in screen, and reply to this message.
`,
  html: shell(
    'Password changed',
    `<tr><td style="padding:24px 40px 32px;">
       <p style="font-size:15px;margin:0 0 16px;">${greeting(escapeHtml(firstName(input.fullName)))}</p>
       <p style="font-size:15px;margin:0 0 16px;">The password for your ${SHOP} account was just changed. If you were signed in on other devices, they have been signed out.</p>
       <p style="font-size:15px;margin:0 0 16px;">If this was you, there is nothing more to do.</p>
       <p style="font-size:13px;color:#9aa5b1;margin:0;">If this was not you, reset your password straight away with the &ldquo;forgot password&rdquo; option on the sign-in screen, and reply to this message.</p>
     </td></tr>`,
  ),
});
