import { notFound } from 'next/navigation';

/**
 * Any path under a locale that no page claims. Routing it here, rather than letting Next fall
 * through to the global 404, keeps the visitor inside the shell and their language.
 */
export default function UnknownPage() {
  notFound();
}
