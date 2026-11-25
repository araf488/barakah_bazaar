import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { category } from '../../../test/fixtures';
import { renderWithIntl } from '../../../test/intl';
import { restoreLivePages, setLivePages } from '../../../test/livePages';
import { CategoryTiles } from '../CategoryTiles';

describe('CategoryTiles', () => {
  afterEach(() => restoreLivePages());

  it('filters the new arrivals on this page while category pages do not exist', () => {
    renderWithIntl(<CategoryTiles categories={[category()]} />);

    expect(screen.getByRole('link', { name: 'Dates' })).toHaveAttribute(
      'href',
      '/en?category=dates#new-arrivals',
    );
  });

  it('links to the category page once it exists', () => {
    setLivePages(['category']);
    renderWithIntl(<CategoryTiles categories={[category()]} />);

    expect(screen.getByRole('link', { name: 'Dates' })).toHaveAttribute('href', '/en/c/dates');
  });

  it('uses the category image when the admin set one', () => {
    const { container } = renderWithIntl(
      <CategoryTiles categories={[category({ imageUrl: 'https://cdn.example.test/dates.jpg' })]} />,
    );
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.test/dates.jpg',
    );
  });

  it('shows the first letter of the name, in the reader’s language, when there is no image', () => {
    const { container } = renderWithIntl(<CategoryTiles categories={[category()]} />, 'bn');

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('খ')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders nothing when the categories could not be loaded', () => {
    const { container } = renderWithIntl(<CategoryTiles categories={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
