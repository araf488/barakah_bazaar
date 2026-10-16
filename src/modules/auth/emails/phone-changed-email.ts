import { EmailMessage } from '../../notification/ports/email-sender.port';
import { PlainEmailInput, SHOP, escapeHtml, firstName, greeting, shell } from './email-layout';

/** Everything the changed-number email needs. */
export interface PhoneChangedEmailInput extends PlainEmailInput {
  /** The last digits of the NEW number; the full number is never mailed. */
  readonly lastDigits: string;
}

/**
 * Sent to the account's email after every successful link of a verified number: a first link,
 * a replacement, or a legacy number now proved. Each one adds a way to sign in.
 *
 * Carries **no code, no link and no full number**: if the owner did not make this change,
 * this email is how they find out, and it must not hand anything to whoever did. It says that
 * a password reset takes the number out of sign-in, because that is what a reset now does.
 */
export const buildPhoneChangedEmail = (input: PhoneChangedEmailInput): EmailMessage => ({
  to: input.to,
  subject: 'A phone number was linked to your account',
  body: `${greeting(firstName(input.fullName))}

Your ${SHOP} account now has a verified phone number, ending in ${input.lastDigits}. It can be used to sign in.

If this was you, there is nothing more to do.

If this was not you, reset your password straight away with the "forgot password" option on the sign-in screen, and reply to this message. Resetting your password also stops this number signing you in.
`,
  html: shell(
    'Phone number linked',
    `<tr><td style="padding:24px 40px 32px;">
       <p style="font-size:15px;margin:0 0 16px;">${greeting(escapeHtml(firstName(input.fullName)))}</p>
       <p style="font-size:15px;margin:0 0 16px;">Your ${SHOP} account now has a verified phone number, ending in ${escapeHtml(input.lastDigits)}. It can be used to sign in.</p>
       <p style="font-size:15px;margin:0 0 16px;">If this was you, there is nothing more to do.</p>
       <p style="font-size:13px;color:#9aa5b1;margin:0;">If this was not you, reset your password straight away with the &ldquo;forgot password&rdquo; option on the sign-in screen, and reply to this message. Resetting your password also stops this number signing you in.</p>
     </td></tr>`,
  ),
});
