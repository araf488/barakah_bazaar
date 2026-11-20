import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import bn from '../messages/bn.json';
import en from '../messages/en.json';

const MESSAGES = { bn, en } as const;

/**
 * Renders inside the same provider the locale layout uses, with the real label files. The
 * provider is a wrapper, so `rerender` keeps it.
 */
export const renderWithIntl = (ui: ReactElement, locale: keyof typeof MESSAGES = 'en') =>
  render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Asia/Dhaka">
        {children}
      </NextIntlClientProvider>
    ),
  });
