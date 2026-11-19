import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';

import bn from '../messages/bn.json';
import en from '../messages/en.json';

const MESSAGES = { bn, en } as const;

/** Renders inside the same provider the locale layout uses, with the real label files. */
export const renderWithIntl = (ui: ReactElement, locale: keyof typeof MESSAGES = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Asia/Dhaka">
      {ui}
    </NextIntlClientProvider>,
  );
