import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import prettier from 'eslint-config-prettier';

/** Cognitive-complexity ceiling, identical to the API repo's Sonar gate. */
export const COGNITIVE_COMPLEXITY_MAX = 15;

/** Neither app may import the other; shared packages may import no app. */
const CROSS_APP_BOUNDARY = {
  patterns: [
    {
      group: ['**/apps/storefront/**'],
      message: 'Cross-app import. Move shared code into web/packages/.',
    },
    {
      group: ['**/apps/admin/**'],
      message: 'Cross-app import. Move shared code into web/packages/.',
    },
  ],
};

/**
 * The only `process.env` names web code may read (ruling R7). Storefront server code runs
 * inside the API process, whose environment holds every server secret, so anything not on
 * this list is reported. An esquery regex: no `/` may appear inside it.
 */
const ALLOWED_ENV_NAME = String.raw`/^(NEXT_PUBLIC_\w+|VITE_\w+|NODE_ENV|WEB_INTERNAL_API_BASE_URL|NEXT_RUNTIME)$/`;

/** Attribute selectors matching `process.env` at `path` (`''` for the node itself). */
const processEnvAt = (path) => {
  const prefix = path ? `${path}.` : '';
  return `[${prefix}object.name='process'][${prefix}property.name='env']`;
};

const ENV_ALLOWLIST_MESSAGE =
  'process.env may only be read by an allowlisted name: NEXT_PUBLIC_*, VITE_*, NODE_ENV, ' +
  'WEB_INTERNAL_API_BASE_URL or NEXT_RUNTIME. Server secrets must never reach web code.';

/**
 * `no-restricted-syntax` selectors enforcing {@link ALLOWED_ENV_NAME}, one per way to read it:
 * 1. `process.env.X`, dotted, X off the list;
 * 2. `process.env[k]`, unless k is a string literal on the list (a computed name can't be checked);
 * 3. `const { X } = process.env` / `({ X } = process.env)`: a key off the list, a computed key,
 *    or a rest element;
 * 4. `process.env` used whole (spread, passed, stored), which would hand over every name.
 */
const ENV_ALLOWLIST_SELECTORS = [
  `MemberExpression[computed=false]${processEnvAt('object')}[property.name!=${ALLOWED_ENV_NAME}]`,
  `MemberExpression[computed=true]${processEnvAt('object')}[property.value!=${ALLOWED_ENV_NAME}]`,
  `:matches(VariableDeclarator${processEnvAt('init')}, AssignmentExpression${processEnvAt('right')})` +
    ` > ObjectPattern > :matches(Property[computed=true], Property[key.name!=${ALLOWED_ENV_NAME}], RestElement)`,
  `:not(MemberExpression, VariableDeclarator[id.type='ObjectPattern'], AssignmentExpression[left.type='ObjectPattern'])` +
    ` > MemberExpression${processEnvAt('')}`,
].map((selector) => ({ selector, message: ENV_ALLOWLIST_MESSAGE }));

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { sonarjs },
    rules: {
      'sonarjs/cognitive-complexity': ['error', COGNITIVE_COMPLEXITY_MAX],
      'no-restricted-imports': ['error', CROSS_APP_BOUNDARY],
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  {
    // commitlint.config.js is plain CommonJS (commitlint's own convention);
    // recognise its `module`/`require` globals instead of tripping no-undef.
    // typescript-eslint's recommended config only targets ts/tsx/mts/cts
    // files, so this stays necessary for plain .js config files.
    files: ['**/*.config.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    // Secrets that must never reach a browser bundle (spec §8). All three
    // names from Global Constraints must appear in the selector — the list
    // is the contract.
    files: ['**/*.{ts,tsx,mjs,js}'],
    // `ignores` exempts only the file defining the rule, which necessarily
    // names them. Using a `**/`-prefixed pattern keeps this exemption
    // path-shape independent rather than relying on any specific
    // basePath/anchoring behaviour of the glob matcher.
    ignores: ['**/eslint.config.mjs'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|DIRECT_URL/]',
          message: 'Server-only secret name must not appear in frontend code.',
        },
        // Same rule key, same block: a second `no-restricted-syntax` block would replace
        // the literal ban above rather than add to it.
        ...ENV_ALLOWLIST_SELECTORS,
      ],
    },
  },
  prettier,
  // All four patterns use a leading `**/` so matching is path-shape
  // independent (matches regardless of nesting depth or how eslint's base
  // path is computed for a given invocation).
  { ignores: ['**/dist/**', '**/.next/**', '**/generated/**', '**/docs/**'] },
);
