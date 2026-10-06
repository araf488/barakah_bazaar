/**
 * The pieces every auth email shares: the shop name, the greeting rule, HTML escaping and the
 * table-based shell. One copy, so a verification email and a reset email cannot drift apart in
 * how they greet someone or what they escape.
 */

/** Everything the credential-free emails need. */
export interface PlainEmailInput {
  readonly to: string;
  readonly fullName: string;
}

export const SHOP = 'Barakah Bazaar';

/** First name only: "Dear Aisha Rahman" reads like a form letter. Empty when no name is given. */
export const firstName = (fullName: string): string => fullName.trim().split(' ')[0] ?? '';

/**
 * "Hello Name," when a name is given, otherwise plain "Hello," — never invents one.
 *
 * "Dear Friend" / "Hello Friend" is a phrase spam classifiers weight, and this application
 * sends from a verified address with no registered domain, so it cannot align SPF or DKIM and
 * already lands in spam more than it should. Inventing a filler name only makes that worse.
 * The name must move with the comma: `Hello ${name},` on an empty name would leave "Hello ,".
 */
export const greeting = (name: string): string => (name ? `Hello ${name},` : 'Hello,');

/** Escape HTML special characters. & must be escaped first to avoid double-encoding. */
export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const shell = (heading: string, inner: string): string => `<!DOCTYPE html>
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
