import { useTranslations } from 'next-intl';

import { Link } from '../../i18n/navigation';
import { ROUTES } from '../../lib/routes';

/** A missing page or product inside a locale: same shell, a plain way back. */
export default function LocaleNotFound() {
  const t = useTranslations('notFound');

  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="mb-3 font-display text-3xl text-ink">{t('title')}</h1>
      <p className="mb-8 text-sm text-subtle">{t('body')}</p>
      <Link
        href={ROUTES.home}
        className="inline-flex min-h-11 items-center rounded-full bg-brand px-6 font-semibold text-white transition hover:bg-brand-light active:scale-95"
      >
        {t('backHome')}
      </Link>
    </div>
  );
}
