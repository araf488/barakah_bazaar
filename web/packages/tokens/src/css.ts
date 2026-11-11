import type { Tokens } from './tokens';

/** Namespace for every emitted custom property, so brand values never collide. */
export const CSS_VAR_PREFIX = '--bb';

/** `brandLight` → `brand-light`, so the CSS name reads the way CSS names read. */
const toKebabCase = (name: string): string =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const declaration = (group: string, name: string, value: string): string =>
  `  ${CSS_VAR_PREFIX}-${group}-${toKebabCase(name)}: ${value};`;

const declarationsFor = (group: string, values: Readonly<Record<string, string>>): string[] =>
  Object.entries(values).map(([name, value]) => declaration(group, name, value));

/**
 * Renders the tokens as a `:root` block. This is the format Flutter, email
 * templates and any non-MUI consumer read, which is why it lives here rather
 * than inside the theme package.
 */
export const toCssVariables = (t: Tokens): string => {
  const lines = [
    ...declarationsFor('color', t.color),
    ...declarationsFor('font', t.font),
    ...declarationsFor('space', t.space),
    ...declarationsFor('radius', t.radius),
    ...declarationsFor('font-size', t.fontSize),
    ...declarationsFor('duration', t.motion.duration),
    ...declarationsFor('easing', t.motion.easing),
  ];

  return `:root {\n${lines.join('\n')}\n}\n`;
};
