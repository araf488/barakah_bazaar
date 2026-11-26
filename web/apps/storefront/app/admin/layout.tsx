import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';

import { PORTAL_NAME } from '../../lib/admin/copy';
import en from '../../messages/en.json';
import { fontVariables } from '../fonts';
import '../globals.css';

/** The only storefront labels the portal borrows: the password field's show and hide buttons. */
const BORROWED_MESSAGES = { auth: { fields: en.auth.fields } };

export const metadata: Metadata = {
  title: { default: PORTAL_NAME, template: `%s · ${PORTAL_NAME}` },
  robots: { index: false, follow: false },
};

/**
 * The staff portal's document shell. It sits beside the storefront's locale layout, not inside
 * it: English only, no shop header, its own session cookies (see lib/admin/cookies.ts).
 */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="min-h-screen bg-cream text-ink">
        <NextIntlClientProvider locale="en" messages={BORROWED_MESSAGES} timeZone="Asia/Dhaka">
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
