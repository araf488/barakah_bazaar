import { describe, expect, it } from 'vitest';

import bn from '../bn.json';
import en from '../en.json';

type MessageTree = { [key: string]: string | MessageTree };

/** `{ a: { b: 'x' } }` → `[['a.b', 'x']]`, so two files compare key by key. */
const flatten = (tree: MessageTree, prefix = ''): Array<[string, string]> =>
  Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value]] : flatten(value, path);
  });

const keys = (tree: MessageTree): string[] =>
  flatten(tree)
    .map(([key]) => key)
    .sort();

describe('UI label files', () => {
  it('define exactly the same keys in Bangla and English (foundation spec §6.2)', () => {
    expect(keys(bn)).toEqual(keys(en));
  });

  it.each([
    ['bn', bn],
    ['en', en],
  ])('leave no label empty in %s', (_locale, messages) => {
    const empty = flatten(messages).filter(([, value]) => value.trim() === '');
    expect(empty).toEqual([]);
  });
});
