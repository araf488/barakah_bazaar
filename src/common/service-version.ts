import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const UNKNOWN_VERSION = '0.0.0';

/**
 * Reads the deployed version from package.json once, at import time.
 *
 * Importing the JSON directly would drag the repo root into the TypeScript
 * output layout, so this reads it at runtime from the working directory (the
 * Dockerfile copies package.json for exactly this reason) and falls back
 * rather than failing a health check over a missing file.
 */
const readVersion = (): string => {
  try {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
};

export const SERVICE_VERSION = readVersion();
