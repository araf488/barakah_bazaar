/**
 * The brand's single source of truth, transcribed from the Figma Make file's
 * `@theme` block. Framework-free on purpose: the MUI theme, the Flutter app and
 * future email templates are all consumers of these values, never owners of them
 * (spec §3.1).
 */

/** Every colour the design defines. Names are the Figma file's own vocabulary. */
export const color = {
  brand: '#1a3d2b',
  brandLight: '#2d6448',
  brandDark: '#0f2418',
  gold: '#c8941a',
  goldLight: '#e0aa30',
  cream: '#faf8f2',
  warm: '#f0ece2',
  ink: '#1c1a14',
  subtle: '#7a7060',
  border: '#e4ddd0',
} as const;

/**
 * Bengali is a separate role rather than a fallback appended to `body`, because
 * neither Fraunces nor Outfit carries a Bengali glyph. Bangla headlines and the
 * taka sign — U+09F3, which sits in the Bengali block and therefore appears in
 * every price on every page — would otherwise render in a system fallback.
 */
export const font = {
  display: '"Fraunces", Georgia, serif',
  body: '"Outfit", system-ui, sans-serif',
  bengali: '"Hind Siliguri", "Outfit", system-ui, sans-serif',
} as const;

/**
 * The design is laid out on a four-pixel grid — every spacing utility in it is a
 * multiple of `0.25rem`. These are the steps it actually leans on; the grid unit
 * is exported separately so MUI's `spacing` factory can be driven from it.
 */
export const SPACE_GRID_UNIT_REM = 0.25;

export const space = {
  xs: '0.5rem',
  sm: '0.75rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '4rem',
} as const;

/** The four corner radii the design uses, plus the pill it uses most of all. */
export const radius = {
  lg: '0.5rem',
  xl: '0.75rem',
  '2xl': '1rem',
  '3xl': '1.5rem',
  full: '9999px',
} as const;

/** The type ramp, from caption to hero headline. */
export const fontSize = {
  xs: '0.75rem',
  sm: '0.875rem',
  base: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  '3xl': '1.875rem',
  '4xl': '2.25rem',
  '5xl': '3rem',
  '6xl': '3.75rem',
  '7xl': '4.5rem',
} as const;

/**
 * `decelerate` is the design's signature curve: six of its eleven animations
 * share it, so it is the default for anything that enters the viewport. The two
 * long durations belong to the ambient loops — the announcement marquee and the
 * floating hero badge — and are named rather than folded into the ramp.
 */
export const motion = {
  duration: {
    fast: '240ms',
    base: '320ms',
    slow: '400ms',
    float: '3.5s',
    marquee: '28s',
  },
  easing: {
    decelerate: 'cubic-bezier(0.16,1,0.3,1)',
    in: 'ease-in',
    out: 'ease-out',
    inOut: 'ease-in-out',
    linear: 'linear',
  },
} as const;

export const tokens = { color, font, space, radius, fontSize, motion } as const;

export type Tokens = typeof tokens;
export type ColorName = keyof typeof color;
export type FontRole = keyof typeof font;
export type SpaceStep = keyof typeof space;
export type RadiusStep = keyof typeof radius;
export type FontSizeStep = keyof typeof fontSize;
