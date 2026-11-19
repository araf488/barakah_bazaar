import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../../test/intl';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/bn/nope',
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const { default: LocaleNotFound } = await import('../not-found');
const { default: UnknownPage } = await import('../[...rest]/page');

describe('locale not-found page', () => {
  it('says the page is missing, in the reader’s language, with a way home', () => {
    renderWithIntl(<LocaleNotFound />, 'bn');

    expect(
      screen.getByRole('heading', { level: 1, name: 'পৃষ্ঠাটি খুঁজে পাওয়া যায়নি' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'হোম পেজে ফিরুন' })).toHaveAttribute('href', '/bn');
  });

  it('is what any unclaimed path under a locale renders', () => {
    expect(() => UnknownPage()).toThrow('NEXT_NOT_FOUND');
  });
});
