import { notFound } from 'next/navigation';

/**
 * Any admin path no page claims. Without this Next would answer with the shop's bilingual 404
 * outside the portal; this hands it to `app/admin/not-found.tsx` instead.
 */
export default function UnknownAdminPage() {
  notFound();
}
