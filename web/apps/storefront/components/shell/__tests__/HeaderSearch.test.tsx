import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, page, product } from '../../../test/fixtures';
import { openSearch } from '../../../lib/searchEvents';
import { renderWithIntl } from '../../../test/intl';
import { restoreLivePages, setLivePages } from '../../../test/livePages';
import { HeaderSearch } from '../HeaderSearch';

const dialog = () => screen.getByRole('dialog', { hidden: true });
const input = () => screen.getByRole('searchbox', { name: 'Search products', hidden: true });

const openWithPill = () =>
  fireEvent.click(screen.getByRole('button', { name: /Search dates, doi, fresh fruit/ }));

const type = (value: string) => fireEvent.change(input(), { target: { value } });

describe('HeaderSearch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreLivePages();
  });

  it('opens the search dialog from the header pill and focuses the input', () => {
    renderWithIntl(<HeaderSearch />);
    expect(dialog()).not.toHaveAttribute('open');

    openWithPill();

    expect(dialog()).toHaveAttribute('open');
    expect(input()).toHaveFocus();
  });

  it('opens on the "/" key from anywhere on the page', () => {
    renderWithIntl(<HeaderSearch />);

    fireEvent.keyDown(window, { key: '/' });

    expect(dialog()).toHaveAttribute('open');
  });

  it('opens with a query when another control asks it to', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page([])));
    vi.stubGlobal('fetch', fetchMock);
    renderWithIntl(<HeaderSearch />);

    act(() => openSearch('Dates'));

    expect(dialog()).toHaveAttribute('open');
    expect(input()).toHaveValue('Dates');
    await screen.findByText('No products match “Dates”');
  });

  it('leaves "/" alone while the visitor is typing in another field', () => {
    renderWithIntl(
      <>
        <input aria-label="Note" />
        <HeaderSearch />
      </>,
    );

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note' }), { key: '/' });

    expect(dialog()).not.toHaveAttribute('open');
  });

  it('suggests starter searches before anything is typed', () => {
    renderWithIntl(<HeaderSearch />);
    openWithPill();

    expect(screen.getByText('Try searching')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajwa dates', hidden: true })).toBeInTheDocument();
  });

  it('searches the API after the visitor pauses, and links each match to its product', async () => {
    setLivePages(['product']);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page([product()])));
    vi.stubGlobal('fetch', fetchMock);
    renderWithIntl(<HeaderSearch />);
    openWithPill();

    type('ajwa');

    const link = await screen.findByRole('link', { name: /Ajwa Dates/, hidden: true });
    expect(link).toHaveAttribute('href', '/en/p/ajwa-dates');
    expect(within(link).getByText('from ৳1,250.00')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('search=ajwa');
    expect(screen.getByRole('status', { hidden: true })).toHaveTextContent('1 product');
  });

  it('lists matches without linking them while product pages do not exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(page([product()]))));
    renderWithIntl(<HeaderSearch />);
    openWithPill();

    type('ajwa');

    expect(await screen.findByText('Ajwa Dates')).toBeInTheDocument();
    expect(screen.getByText('from ৳1,250.00')).toBeInTheDocument();
    expect(screen.queryByRole('link', { hidden: true })).not.toBeInTheDocument();
  });

  it('runs a starter search when its chip is picked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page([])));
    vi.stubGlobal('fetch', fetchMock);
    renderWithIntl(<HeaderSearch />);
    openWithPill();

    fireEvent.click(screen.getByRole('button', { name: 'Medjool dates', hidden: true }));

    expect(input()).toHaveValue('Medjool');
    await screen.findByText('No products match “Medjool”');
  });

  it('says so when the API cannot search', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    renderWithIntl(<HeaderSearch />);
    openWithPill();

    type('doi');

    expect(await screen.findByRole('alert', { hidden: true })).toHaveTextContent(
      'Search is unavailable right now. Please try again in a moment.',
    );
  });

  it('does not search for a single character', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithIntl(<HeaderSearch />);
    openWithPill();

    type('d');
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Try searching')).toBeInTheDocument();
  });

  it('closes from its close button and from a click on the backdrop', () => {
    renderWithIntl(<HeaderSearch />);

    openWithPill();
    fireEvent.click(screen.getByRole('button', { name: 'Close search', hidden: true }));
    expect(dialog()).not.toHaveAttribute('open');

    openWithPill();
    fireEvent.click(dialog());
    expect(dialog()).not.toHaveAttribute('open');
  });

  it('closes on one Escape from the search field, even with text in it', () => {
    renderWithIntl(<HeaderSearch />);
    openWithPill();
    type('dates');

    fireEvent.keyDown(input(), { key: 'Escape' });

    expect(dialog()).not.toHaveAttribute('open');
  });

  it('starts empty each time it opens', () => {
    renderWithIntl(<HeaderSearch />);
    openWithPill();
    type('dates');
    fireEvent.click(screen.getByRole('button', { name: 'Close search', hidden: true }));

    openWithPill();

    expect(input()).toHaveValue('');
  });
});
