import { describe, expect, it } from 'vitest';

import { CSS_VAR_PREFIX, toCssVariables, tokens } from '../index';

describe('brand tokens', () => {
  it('exposes every brand colour with the hex the Figma file defines', () => {
    expect(tokens.color.brand).toBe('#1a3d2b');
    expect(tokens.color.brandLight).toBe('#2d6448');
    expect(tokens.color.brandDark).toBe('#0f2418');
    expect(tokens.color.gold).toBe('#c8941a');
    expect(tokens.color.goldLight).toBe('#e0aa30');
    expect(tokens.color.cream).toBe('#faf8f2');
    expect(tokens.color.warm).toBe('#f0ece2');
    expect(tokens.color.ink).toBe('#1c1a14');
    expect(tokens.color.subtle).toBe('#7a7060');
    expect(tokens.color.border).toBe('#e4ddd0');
  });

  it('assigns the editorial serif to display and the geometric sans to body', () => {
    expect(tokens.font.display).toContain('Fraunces');
    expect(tokens.font.body).toContain('Outfit');
  });

  it('names a Bengali face, because the Figma font stack has none', () => {
    expect(tokens.font.bengali).toContain('Hind Siliguri');
  });

  it('carries no monospace role, which nothing in the design uses', () => {
    expect(tokens.font).not.toHaveProperty('mono');
  });

  it('scales spacing on the four-pixel grid the design is built on', () => {
    expect(tokens.space.md).toBe('1rem');
    expect(tokens.space.xs).toBe('0.5rem');
    expect(tokens.space['2xl']).toBe('4rem');
  });

  it('rounds corners to the four radii the design actually uses, plus the pill', () => {
    expect(tokens.radius.lg).toBe('0.5rem');
    expect(tokens.radius.xl).toBe('0.75rem');
    expect(tokens.radius['2xl']).toBe('1rem');
    expect(tokens.radius['3xl']).toBe('1.5rem');
    expect(tokens.radius.full).toBe('9999px');
  });

  it('spans the type ramp from caption to hero', () => {
    expect(tokens.fontSize.xs).toBe('0.75rem');
    expect(tokens.fontSize.base).toBe('1rem');
    expect(tokens.fontSize['7xl']).toBe('4.5rem');
  });

  it('keeps the signature deceleration curve the design reuses across transitions', () => {
    expect(tokens.motion.easing.decelerate).toBe('cubic-bezier(0.16,1,0.3,1)');
    expect(tokens.motion.duration.base).toBe('320ms');
    expect(tokens.motion.duration.marquee).toBe('28s');
  });

  it('emits one CSS custom property per colour, prefixed', () => {
    const css = toCssVariables(tokens);

    expect(CSS_VAR_PREFIX).toBe('--bb');
    expect(css).toContain('--bb-color-brand: #1a3d2b;');
    expect(css.startsWith(':root {')).toBe(true);
  });

  it('hyphenates camel-cased colour names into their CSS custom property', () => {
    expect(toCssVariables(tokens)).toContain('--bb-color-brand-light: #2d6448;');
  });

  it('has no orphaned colour — every colour reaches the CSS output', () => {
    const css = toCssVariables(tokens);

    for (const name of Object.keys(tokens.color)) {
      expect(css).toMatch(new RegExp(`--bb-color-[a-z-]*:`));
      expect(css.includes(tokens.color[name as keyof typeof tokens.color])).toBe(true);
    }
  });

  it('carries every token group into the CSS output, not colours alone', () => {
    const css = toCssVariables(tokens);

    expect(css).toContain('--bb-font-display:');
    expect(css).toContain('--bb-space-md: 1rem;');
    expect(css).toContain('--bb-radius-full: 9999px;');
    expect(css).toContain('--bb-font-size-base: 1rem;');
    expect(css).toContain('--bb-duration-base: 320ms;');
    expect(css).toContain('--bb-easing-decelerate: cubic-bezier(0.16,1,0.3,1);');
  });
});
