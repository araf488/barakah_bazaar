import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../../test/intl';
import { navigationState } from '../../../test/navigation';
import { LocaleSwitcher } from '../LocaleSwitcher';

describe('LocaleSwitcher', () => {
  afterEach(() => {
    navigationState.pathname = '/en';
  });

  it('offers Bangla on an English page, keeping the visitor on the same product', () => {
    navigationState.pathname = '/en/p/ajwa-dates';
    renderWithIntl(<LocaleSwitcher />, 'en');

    const link = screen.getByRole('link', { name: 'Switch to Bangla' });
    expect(link).toHaveAttribute('href', '/bn/p/ajwa-dates');
    expect(link).toHaveAttribute('hreflang', 'bn');
    expect(link).toHaveTextContent('বাংলা');
  });

  it('offers English on a Bangla page, labelled in Bangla', () => {
    navigationState.pathname = '/bn';
    renderWithIntl(<LocaleSwitcher />, 'bn');

    const link = screen.getByRole('link', { name: 'ইংরেজিতে দেখুন' });
    expect(link).toHaveAttribute('href', '/en');
    expect(link).toHaveTextContent('English');
  });
});
