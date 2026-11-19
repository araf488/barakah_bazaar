import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

/** The route segment Next hands the page; the proxy guarantees it is a known locale. */
const PARAMS = { params: Promise.resolve({ locale: 'en' }) };

describe('storefront home page', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the heading and API up when health succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    render(await Page(PARAMS));
    expect(screen.getByRole('heading', { name: 'Barakah Bazaar' })).toBeInTheDocument();
    expect(screen.getByText('API: up')).toBeInTheDocument();
  });

  it('marks the page with the locale from its route segment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    render(await Page(PARAMS));
    expect(screen.getByRole('main')).toHaveAttribute('data-locale', 'en');
  });

  it('renders API unavailable and does not throw when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    render(await Page(PARAMS));
    expect(screen.getByText('API: unavailable')).toBeInTheDocument();
  });

  it('renders API unavailable on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    render(await Page(PARAMS));
    expect(screen.getByText('API: unavailable')).toBeInTheDocument();
  });
});
