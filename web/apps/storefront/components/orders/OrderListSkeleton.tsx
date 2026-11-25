import { useTranslations } from 'next-intl';

/** Placeholder cards while a page of orders loads. */
export const SKELETON_CARDS = 3;

export function OrderListSkeleton() {
  const t = useTranslations('orders');
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <ul aria-hidden="true" className="space-y-3">
        {Array.from({ length: SKELETON_CARDS }, (_, index) => (
          <li key={index} className="rounded-2xl border border-border bg-white p-5">
            <span className="block h-4 w-1/3 rounded bg-warm motion-safe:animate-pulse" />
            <span className="mt-2 block h-3 w-1/2 rounded bg-warm motion-safe:animate-pulse" />
            <span className="mt-4 block h-4 w-3/4 rounded bg-warm motion-safe:animate-pulse" />
            <span className="mt-3 block h-5 w-1/4 rounded bg-warm motion-safe:animate-pulse" />
          </li>
        ))}
      </ul>
    </div>
  );
}
