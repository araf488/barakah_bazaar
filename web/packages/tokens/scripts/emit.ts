import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emitArtifacts, tokens } from '../src/index';

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const [filename, contents] of Object.entries(emitArtifacts(tokens))) {
  writeFileSync(join(OUTPUT_DIR, filename), contents, 'utf8');
  console.log(`wrote ${join(OUTPUT_DIR, filename)}`);
}
