import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../test/intl';
import { Eyebrow } from '../Eyebrow';

describe('Eyebrow', () => {
  it('tracks and capitalises English labels, as the design does', () => {
    renderWithIntl(<Eyebrow className="text-subtle">New</Eyebrow>, 'en');
    expect(screen.getByText('New').className).toContain('tracking-[0.2em] uppercase');
  });

  it('leaves Bangla untracked, so conjuncts stay joined', () => {
    renderWithIntl(<Eyebrow className="text-subtle">নতুন</Eyebrow>, 'bn');
    expect(screen.getByText('নতুন').className).not.toMatch(/tracking|uppercase/);
  });
});
