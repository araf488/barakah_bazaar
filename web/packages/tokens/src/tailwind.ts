import type { AnimationName, AnimationSpec, Tokens } from './tokens';

/** The committed theme file, next to this module, that the web apps `@import`. */
export const THEME_CSS_FILENAME = 'theme.css';

/** First line of the generated file, so nobody edits it by hand and loses the edit. */
export const THEME_CSS_HEADER =
  '/* Generated from src/tokens.ts by `npm run emit -w @barakah/tokens`. Do not edit by hand. */';

/**
 * Tailwind's name for each font role. The Figma file calls the body face `sans`, so the
 * utilities read `font-sans`, `font-display` and `font-bengali` exactly as its markup does.
 */
const FONT_THEME_NAME: Readonly<Record<keyof Tokens['font'], string>> = {
  display: 'display',
  body: 'sans',
  bengali: 'bengali',
};

/**
 * The keyframes behind each animation, verbatim from the Figma file's stylesheet. Geometry is
 * CSS-only, which is why it lives here and not in the framework-free token object.
 */
const KEYFRAMES: Readonly<Record<AnimationName, string>> = {
  marquee: 'from { transform: translateX(0); }\n  to { transform: translateX(-50%); }',
  float: '0%, 100% { transform: translateY(0); }\n  50% { transform: translateY(-10px); }',
  fadeIn: 'from { opacity: 0; }\n  to { opacity: 1; }',
  slideUp:
    'from { opacity: 0; transform: translateY(20px); }\n  to { opacity: 1; transform: translateY(0); }',
  slideRight: 'from { transform: translateX(100%); }\n  to { transform: translateX(0); }',
  slideLeft:
    'from { transform: translateX(-40px); opacity: 0; }\n  to { transform: translateX(0); opacity: 1; }',
  slideDown:
    'from { opacity: 0; transform: translateY(-16px); }\n  to { opacity: 1; transform: translateY(0); }',
  toastIn:
    'from { opacity: 0; transform: translateX(80px) scale(0.96); }\n  to { opacity: 1; transform: translateX(0) scale(1); }',
  toastOut:
    'from { opacity: 1; transform: translateX(0) scale(1); }\n  to { opacity: 0; transform: translateX(80px) scale(0.96); }',
  scaleIn:
    'from { opacity: 0; transform: scale(0.95); }\n  to { opacity: 1; transform: scale(1); }',
  imgSwap:
    'from { opacity: 0; transform: scale(1.04); }\n  to { opacity: 1; transform: scale(1); }',
};

/** `brandLight` → `brand-light`, `fadeIn` → `fade-in`: the names the Figma utilities use. */
const toKebabCase = (name: string): string =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const themeLine = (name: string, value: string): string => `  --${name}: ${value};`;

const animationValue = (name: string, spec: AnimationSpec): string =>
  `${name} ${spec.duration} ${spec.easing} ${spec.repeat}`;

const themeLines = (t: Tokens): string[] => [
  ...Object.entries(t.font).map(([role, stack]) =>
    themeLine(`font-${FONT_THEME_NAME[role as keyof Tokens['font']]}`, stack),
  ),
  ...Object.entries(t.color).map(([name, hex]) => themeLine(`color-${toKebabCase(name)}`, hex)),
  ...Object.entries(t.animation).map(([name, spec]) => {
    const cssName = toKebabCase(name);
    return themeLine(`animate-${cssName}`, animationValue(cssName, spec));
  }),
];

const keyframeBlocks = (t: Tokens): string[] =>
  Object.keys(t.animation).map(
    (name) => `@keyframes ${toKebabCase(name)} {\n  ${KEYFRAMES[name as AnimationName]}\n}`,
  );

/**
 * Renders the tokens as a Tailwind v4 `@theme` block plus the keyframes it names. A web app
 * imports the result after `tailwindcss`, and `bg-brand`, `font-display` and `animate-marquee`
 * then exist exactly as the Figma markup spells them.
 */
export const toTailwindTheme = (t: Tokens): string =>
  [
    THEME_CSS_HEADER,
    '',
    `@theme {\n${themeLines(t).join('\n')}\n}`,
    '',
    keyframeBlocks(t).join('\n\n'),
    '',
  ].join('\n');
