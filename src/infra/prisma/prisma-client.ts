/**
 * Single import point for generated Prisma types.
 *
 * Prisma 7 generates its client as TypeScript inside the project (see the
 * `output` in prisma/schema.prisma) rather than into node_modules, so the
 * generated directory is untracked and rebuilt by `npm run prisma:generate`
 * (wired to `postinstall`). Importing through this barrel means moving the
 * output path later is a one-line change instead of a repo-wide rewrite.
 */
export * from '../../generated/prisma/client';
