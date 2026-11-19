import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import GlobalNotFound from '../not-found';

type Element = ReactElement<{ lang?: string; children: Element }>;

describe('global not-found page', () => {
  it('owns its document shell, in Bangla, because no locale layout wraps it', () => {
    const html = GlobalNotFound() as Element;

    expect(html.type).toBe('html');
    expect(html.props.lang).toBe('bn');
  });

  it('says the page is missing in both languages and links back home', () => {
    const body = (GlobalNotFound() as Element).props.children;
    render(body.props.children);

    expect(
      screen.getByRole('heading', { name: 'পৃষ্ঠাটি পাওয়া যায়নি · Page not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'হোমে ফিরুন · Back to home' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
