import { describe, expect, it } from 'vitest';
import config, { COGNITIVE_COMPLEXITY_MAX } from '../eslint.config.mjs';

describe('shared eslint config', () => {
  it('caps cognitive complexity at 15', () => {
    expect(COGNITIVE_COMPLEXITY_MAX).toBe(15);
  });

  it('enables the sonarjs cognitive-complexity rule at that ceiling', () => {
    const rules = config.flatMap((block) => (block.rules ? [block.rules] : []));
    const found = rules.find((r) => 'sonarjs/cognitive-complexity' in r);
    expect(found?.['sonarjs/cognitive-complexity']).toEqual(['error', 15]);
  });

  it('forbids cross-app imports in both directions', () => {
    // Serialise only each block's `rules`, never the whole array: typescript-eslint's
    // recommended config carries a self-referential plugin object, so stringifying the
    // array throws on the circular structure. `rules` is the field this asserts on.
    const serialised = JSON.stringify(config.map((block) => block.rules ?? null));
    expect(serialised).toContain('apps/storefront');
    expect(serialised).toContain('apps/admin');
  });
});
