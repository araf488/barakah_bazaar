import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../../test/intl';
import { productDetail } from '../../../test/productDetail';
import { ProductGallery } from '../ProductGallery';

const IMAGES = productDetail().images;

describe('ProductGallery', () => {
  it('opens on the primary image, with its own alt text, loaded first', () => {
    renderWithIntl(<ProductGallery images={IMAGES} name="Ajwa Dates" />);
    const main = screen.getByRole('img', { name: 'A bowl of Ajwa dates' });

    expect(main).toHaveAttribute('src', 'https://cdn.example.test/ajwa-1.jpg');
    expect(main).toHaveAttribute('fetchpriority', 'high');
    expect(main).toHaveAttribute('width', '800');
  });

  it('switches the main image from the thumbnail strip', () => {
    renderWithIntl(<ProductGallery images={IMAGES} name="Ajwa Dates" />);

    fireEvent.click(screen.getByRole('button', { name: 'Show image 2 of 2' }));

    expect(screen.getByRole('img', { name: 'Ajwa Dates' })).toHaveAttribute(
      'src',
      'https://cdn.example.test/ajwa-2.jpg',
    );
    expect(screen.getByRole('button', { name: 'Show image 2 of 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Show image 1 of 2' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('falls back to the product name when an image has no alt text', () => {
    renderWithIntl(
      <ProductGallery images={[{ url: 'x.jpg', altText: '', isPrimary: true }]} name="Doi" />,
    );
    expect(screen.getByRole('img', { name: 'Doi' })).toBeInTheDocument();
  });

  it('shows no thumbnail strip for a single image', () => {
    renderWithIntl(<ProductGallery images={[IMAGES[1]!]} name="Ajwa Dates" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the square, without a broken image, when there are no images', () => {
    const { container } = renderWithIntl(<ProductGallery images={[]} name="Ajwa Dates" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.aspect-square')).not.toBeNull();
  });
});
