import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emitArtifacts, THEME_CSS_FILENAME, tokens, toTailwindTheme } from '../src/index';

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = join(PACKAGE_DIR, 'dist');
/** The Tailwind theme is committed under src/, so the web builds never depend on running this. */
const THEME_CSS_PATH = join(PACKAGE_DIR, 'src', THEME_CSS_FILENAME);

const write = (path: string, contents: string): void => {
  writeFileSync(path, contents, 'utf8');
  console.log(`wrote ${path}`);
};

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const [filename, contents] of Object.entries(emitArtifacts(tokens))) {
  write(join(OUTPUT_DIR, filename), contents);
}

write(THEME_CSS_PATH, toTailwindTheme(tokens));
