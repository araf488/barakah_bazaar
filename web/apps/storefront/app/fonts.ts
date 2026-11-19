import { Fraunces, Hind_Siliguri, Outfit } from 'next/font/google';

// next/font downloads each face at build time and self-hosts it, so no request ever goes to
// Google from a visitor's browser and the fallback is size-adjusted (no layout shift). Its
// options are read statically by the compiler: every value below must stay a literal.

/** Display serif: headings, prices, stat numbers. Variable on weight and optical size. */
const display = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  display: 'swap',
  variable: '--bb-face-display',
});

/** Body sans. Variable on weight (300-700 is what the design uses). */
const body = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--bb-face-body',
});

/**
 * Bengali glyphs, including the taka sign U+09F3 in every price. Neither Latin face carries
 * them, so both font stacks fall through to this one glyph by glyph.
 */
const bengali = Hind_Siliguri({
  subsets: ['bengali'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--bb-face-bengali',
});

/** The three `--bb-face-*` variable classes, applied once on `<html>`. */
export const fontVariables = [display.variable, body.variable, bengali.variable].join(' ');
