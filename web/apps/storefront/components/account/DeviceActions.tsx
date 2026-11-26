'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, useRef, useState } from 'react';

import {
  type DeviceActionState,
  endAllSessionsAction,
  endSessionAction,
} from '../../lib/account/securityActions';

const IDLE: DeviceActionState = { status: 'idle' };

const QUIET_BUTTON =
  'inline-flex min-h-11 items-center rounded-xl border border-border bg-white px-4 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60';
const DANGER_OUTLINE =
  'inline-flex min-h-11 items-center rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-800 transition hover:bg-red-50 active:scale-[0.98]';
const DANGER_BUTTON =
  'inline-flex min-h-11 items-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60';

function Refusal({ state }: { state: DeviceActionState }) {
  const t = useTranslations('security.devices.errors');
  if (state.status !== 'error') {
    return null;
  }
  return (
    <p key={state.at} role="alert" className="text-sm font-medium text-red-800">
      {t(state.error)}
    </p>
  );
}

/** Signs one other device out; the list redraws without it. */
export function EndSessionButton({ id, device }: { id: string; device: string }) {
  const t = useTranslations('security.devices');
  const [state, action, pending] = useActionState(endSessionAction, IDLE);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-label={t('signOutNamed', { device })}
        className={QUIET_BUTTON}
      >
        {pending ? t('signingOut') : t('signOut')}
      </button>
      <Refusal state={state} />
    </form>
  );
}

/**
 * Signs every device out, this one included, behind a confirmation step so a stray tap cannot
 * do it. On success the action sends the visitor to sign in.
 */
export function SignOutEverywhere() {
  const t = useTranslations('security.devices.everywhere');
  const [state, action, pending] = useActionState(endAllSessionsAction, IDLE);
  const [confirming, setConfirming] = useState(false);
  const openRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  if (!confirming) {
    return (
      <div className="space-y-2">
        <button
          ref={openRef}
          type="button"
          onClick={() => setConfirming(true)}
          className={DANGER_OUTLINE}
        >
          {t('open')}
        </button>
        <p className="text-xs text-subtle">{t('hint')}</p>
      </div>
    );
  }

  const keepSignedIn = () => {
    setConfirming(false);
    // The open button is drawn again on the next render; give it focus back once it exists.
    requestAnimationFrame(() => openRef.current?.focus());
  };

  return (
    <form
      action={action}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending) {
          keepSignedIn();
        }
      }}
      className="space-y-3 rounded-2xl border border-red-200 bg-white p-4"
    >
      <h3 id={titleId} className="font-semibold text-ink">
        {t('title')}
      </h3>
      <p className="text-sm text-subtle">{t('body')}</p>
      <Refusal state={state} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} autoFocus className={DANGER_BUTTON}>
          {pending ? t('pending') : t('confirm')}
        </button>
        <button type="button" onClick={keepSignedIn} disabled={pending} className={QUIET_BUTTON}>
          {t('keep')}
        </button>
      </div>
    </form>
  );
}
