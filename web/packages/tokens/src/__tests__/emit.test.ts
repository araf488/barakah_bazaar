import { describe, expect, it } from 'vitest';

import { emitArtifacts, tokens } from '../index';

describe('token artifacts', () => {
  it('emits one file per consumer format', () => {
    expect(Object.keys(emitArtifacts(tokens)).sort()).toEqual(['tokens.css', 'tokens.json']);
  });

  it('emits the CSS custom properties Flutter and email templates read', () => {
    expect(emitArtifacts(tokens)['tokens.css']).toContain('--bb-color-brand: #1a3d2b;');
  });

  it('emits JSON that parses back to the same values', () => {
    const json = emitArtifacts(tokens)['tokens.json'];

    expect(JSON.parse(json ?? '')).toEqual(tokens);
  });

  it('ends every artifact with a newline, so the files are diff-clean', () => {
    for (const contents of Object.values(emitArtifacts(tokens))) {
      expect(contents.endsWith('\n')).toBe(true);
    }
  });
});
