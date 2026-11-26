import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

import { Link } from '../../i18n/navigation';
import { deviceNameOf } from '../../lib/account/device';
import { formatDeviceMoment } from '../../lib/account/format';
import { type DeviceSession, getDeviceSessions } from '../../lib/account/security';
import { signOutAction } from '../../lib/auth/actions';
import { ROUTES } from '../../lib/routes';
import { EndSessionButton, SignOutEverywhere } from './DeviceActions';

const QUIET_BUTTON =
  'inline-flex min-h-11 items-center rounded-xl border border-border bg-white px-4 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand active:scale-[0.98]';

/** The device's shape, from its system: phones and tablets read differently from computers. */
const ICON_BY_SYSTEM: Readonly<Record<string, typeof Monitor>> = {
  Android: Smartphone,
  iOS: Smartphone,
  iPadOS: Tablet,
};

/** A device's name from what its browser said; the browser and system names are not translated. */
export async function DeviceRow({ session, locale }: { session: DeviceSession; locale: string }) {
  const t = await getTranslations('security.devices');
  const { browser, system } = deviceNameOf(session.userAgent);
  const label =
    browser && system
      ? t('deviceOn', { browser, system })
      : (browser ?? system ?? t('unknownDevice'));
  const Icon = ICON_BY_SYSTEM[system ?? ''] ?? Monitor;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-white p-5">
      <div className="flex min-w-0 gap-3">
        <Icon aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-brand" />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
            <span className="break-words">{label}</span>
            {session.current ? (
              <span className="rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-semibold text-white">
                {t('thisDevice')}
              </span>
            ) : null}
          </p>
          {session.lastUsedAt ? (
            <p className="mt-1 text-sm text-subtle">
              {t('lastActive', { when: formatDeviceMoment(session.lastUsedAt, locale) })}
            </p>
          ) : null}
          <p className="mt-1 text-sm text-subtle">
            {t('signedIn', { when: formatDeviceMoment(session.createdAt, locale) })}
            {session.ipAddress ? (
              <>
                {' · '}
                {t.rich('network', {
                  address: session.ipAddress,
                  ip: (chunks) => <span dir="ltr">{chunks}</span>,
                })}
              </>
            ) : null}
          </p>
        </div>
      </div>
      {session.current ? (
        <form action={signOutAction}>
          <button type="submit" className={QUIET_BUTTON}>
            {t('signOut')}
          </button>
        </form>
      ) : (
        <EndSessionButton id={session.id} device={label} />
      )}
    </li>
  );
}

/**
 * Every device signed in to the account, this one first, each with its own sign-out, then the
 * way to sign out of all of them. Unreadable, it says so and offers the page again.
 */
export async function DeviceList() {
  const [outcome, t, locale] = await Promise.all([
    getDeviceSessions(),
    getTranslations('security.devices'),
    getLocale(),
  ]);

  if (!outcome.ok) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-border bg-white px-6 py-10 text-center text-sm text-ink"
      >
        <p>{t('loadError')}</p>
        <Link href={ROUTES.security} className={`${QUIET_BUTTON} mt-4`}>
          {t('retry')}
        </Link>
      </div>
    );
  }

  const others = outcome.sessions.filter((session) => !session.current).length;

  return (
    <div className="space-y-6">
      <ul className="space-y-3">
        {outcome.sessions.map((session) => (
          <DeviceRow key={session.id} session={session} locale={locale} />
        ))}
      </ul>
      {others === 0 ? <p className="text-sm text-subtle">{t('only')}</p> : null}
      <SignOutEverywhere />
    </div>
  );
}

/** Placeholder rows while the device list loads. */
export function DeviceListSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        {label}
      </p>
      <ul aria-hidden="true" className="space-y-3">
        {[0, 1].map((row) => (
          <li key={row} className="rounded-2xl border border-border bg-white p-5">
            <span className="block h-4 w-1/3 rounded bg-warm motion-safe:animate-pulse" />
            <span className="mt-2 block h-3 w-1/2 rounded bg-warm motion-safe:animate-pulse" />
            <span className="mt-2 block h-3 w-2/5 rounded bg-warm motion-safe:animate-pulse" />
          </li>
        ))}
      </ul>
    </div>
  );
}
