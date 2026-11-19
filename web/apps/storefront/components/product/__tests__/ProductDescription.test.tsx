import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../../test/intl';
import { ProductDescription } from '../ProductDescription';

describe('ProductDescription', () => {
  it('renders each paragraph in the reader’s language', () => {
    const { container } = renderWithIntl(
      <ProductDescription product={{ descriptionEn: 'One.\n\nTwo.', descriptionBn: 'এক।' }} />,
    );

    expect(screen.getByRole('heading', { name: 'About this product' })).toBeInTheDocument();
    expect([...container.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'One.',
      'Two.',
    ]);
    expect(container.querySelector('[lang]')).toHaveAttribute('lang', 'en');
  });

  it('marks the fallback language when only the other one exists', () => {
    const { container } = renderWithIntl(
      <ProductDescription product={{ descriptionEn: 'English only.', descriptionBn: null }} />,
      'bn',
    );
    expect(container.querySelector('[lang]')).toHaveAttribute('lang', 'en');
  });

  it('says plainly when there is no description', () => {
    renderWithIntl(<ProductDescription product={{ descriptionEn: null, descriptionBn: null }} />);
    expect(
      screen.getByText('The shop has not added a description for this product yet.'),
    ).toBeInTheDocument();
  });
});
