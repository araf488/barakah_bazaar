import { useTranslations } from 'next-intl';

import { Link } from '../../i18n/navigation';
import { ORDER_FILTERS, type OrderFilter, orderListQuery } from '../../lib/orders/listQuery';
import { ROUTES } from '../../lib/routes';

/** The list's filters as plain links, so they work before hydration and can be shared. */
export function OrderFilters({ active }: { active: OrderFilter }) {
  const t = useTranslations('orders');
  return (
    <nav aria-label={t('filtersLabel')} className="-mx-4 overflow-x-auto px-4 pb-1">
      <ul className="flex gap-2">
        {ORDER_FILTERS.map((filter) => {
          const current = filter === active;
          return (
            <li key={filter}>
              <Link
                href={{ pathname: ROUTES.orders, query: orderListQuery({ filter, page: 1 }) }}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition ${
                  current
                    ? 'border-brand bg-brand text-white'
                    : 'border-border bg-white text-ink hover:border-brand hover:text-brand'
                }`}
              >
                {t(`filters.${filter}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
