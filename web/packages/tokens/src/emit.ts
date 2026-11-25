import { toCssVariables } from './css';
import type { Tokens } from './tokens';

/**
 * The two serialised formats. Keeping this a pure function — filename to
 * contents — is what lets the artifacts be asserted without touching the disk;
 * `scripts/emit.ts` is then only the write.
 */
export const emitArtifacts = (t: Tokens): Record<string, string> => ({
  'tokens.css': toCssVariables(t),
  'tokens.json': `${JSON.stringify(t, null, 2)}\n`,
});
