import { Fraunces, Noto_Sans_Bengali, Noto_Serif_Bengali, Outfit } from 'next/font/google';

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
 * them, so each stack falls through to a Bengali face glyph by glyph: the sans beside Outfit
 * for running text, the serif beside Fraunces for headings and prices. Both are variable on
 * weight, so one file per face covers every weight the design uses.
 */
const bengali = Noto_Sans_Bengali({
  subsets: ['bengali'],
  display: 'swap',
  variable: '--bb-face-bengali',
});

const bengaliDisplay = Noto_Serif_Bengali({
  subsets: ['bengali'],
  display: 'swap',
  variable: '--bb-face-bengali-display',
});

/** The four `--bb-face-*` variable classes, applied once on `<html>`. */
export const fontVariables = [
  display.variable,
  body.variable,
  bengali.variable,
  bengaliDisplay.variable,
].join(' ');
