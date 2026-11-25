import { describe, expect, it } from 'vitest';

import { pickDescription } from '../description';

describe('pickDescription', () => {
  it('returns the reader’s language, split into paragraphs', () => {
    expect(
      pickDescription({ descriptionEn: 'One.\n\n  Two.  \n\n', descriptionBn: 'এক' }, 'en'),
    ).toEqual({
      paragraphs: ['One.', 'Two.'],
      lang: 'en',
    });
  });

  it('falls back to the other language and says which one it returned', () => {
    expect(pickDescription({ descriptionEn: 'Only English.', descriptionBn: '  ' }, 'bn')).toEqual({
      paragraphs: ['Only English.'],
      lang: 'en',
    });
  });

  it('returns nothing when neither language has a description', () => {
    expect(pickDescription({ descriptionEn: null, descriptionBn: null }, 'bn')).toBeNull();
  });
});
