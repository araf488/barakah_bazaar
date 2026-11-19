import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { tokens, toTailwindTheme } from '../index';

const committedTheme = (): string => readFileSync(join(__dirname, '..', 'theme.css'), 'utf8');

describe('tailwind theme', () => {
  it('names colours the way the Figma utilities spell them', () => {
    const css = toTailwindTheme(tokens);

    expect(css).toContain('  --color-brand: #1a3d2b;');
    expect(css).toContain('  --color-brand-light: #2d6448;');
    expect(css).toContain('  --color-gold-light: #e0aa30;');
  });

  it('maps the body role to font-sans, as the Figma stylesheet does', () => {
    const css = toTailwindTheme(tokens);

    expect(css).toContain('  --font-sans: "Outfit", system-ui, sans-serif;');
    expect(css).toContain('  --font-display: "Fraunces", Georgia, serif;');
    expect(css).toContain('  --font-bengali: "Hind Siliguri", "Outfit", system-ui, sans-serif;');
    expect(css).not.toContain('--font-body');
  });

  it('reproduces the Figma animation timings, one duration step per animation', () => {
    const css = toTailwindTheme(tokens);

    expect(css).toContain('  --animate-marquee: marquee 28s linear infinite;');
    expect(css).toContain('  --animate-float: float 3.5s ease-in-out infinite;');
    expect(css).toContain('  --animate-fade-in: fade-in 400ms ease-out forwards;');
    expect(css).toContain(
      '  --animate-slide-right: slide-right 380ms cubic-bezier(0.16,1,0.3,1) forwards;',
    );
    expect(css).toContain('  --animate-toast-out: toast-out 240ms ease-in forwards;');
    expect(css).toContain(
      '  --animate-scale-in: scale-in 300ms cubic-bezier(0.16,1,0.3,1) forwards;',
    );
    expect(css).toContain('  --animate-img-swap: img-swap 250ms ease-out forwards;');
  });

  it('defines a keyframe for every animation it names, and no other', () => {
    const css = toTailwindTheme(tokens);
    const named = [...css.matchAll(/--animate-[a-z-]+: ([a-z-]+) /g)].map((m) => m[1]);
    const defined = [...css.matchAll(/@keyframes ([a-z-]+) \{/g)].map((m) => m[1]);

    expect(named).toHaveLength(11);
    expect(defined).toEqual(named);
  });

  it('keeps the marquee loop seamless by travelling exactly half its doubled width', () => {
    expect(toTailwindTheme(tokens)).toContain(
      '@keyframes marquee {\n  from { transform: translateX(0); }\n  to { transform: translateX(-50%); }\n}',
    );
  });

  it('opens with the do-not-edit header and ends with a newline', () => {
    const css = toTailwindTheme(tokens);

    expect(css.startsWith('/* Generated from src/tokens.ts')).toBe(true);
    expect(css.endsWith('\n')).toBe(true);
  });

  it('matches the committed theme.css, so a token change cannot ship without re-emitting', () => {
    expect(committedTheme()).toBe(toTailwindTheme(tokens));
  });
});
