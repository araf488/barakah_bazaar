'use client';

import Link from 'next/link';
import { startTransition, useActionState, useId, useState } from 'react';

import { enableMfaAction, type MfaSetupState, startMfaSetupAction } from '../../lib/admin/actions';
import { SETUP_COPY, SIGN_IN_ERRORS, type SignInError } from '../../lib/admin/copy';
import { ADMIN_ROUTES } from '../../lib/admin/routes';
import { STAFF_CODE_LENGTH } from '../../lib/admin/rules';
import { FORM_ERROR_ID_SUFFIX, SubmitButton, TextField } from '../auth/fields';
import { submitKeepingChoices } from '../checkout/submitKeepingChoices';
import { FormAlert } from './FormAlert';
import { QrCode } from './QrCode';

const IDLE: MfaSetupState = { status: 'idle' };
const PRIMARY =
  'flex min-h-12 w-full items-center justify-center rounded-2xl bg-brand px-6 font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-light disabled:opacity-60';
const QUIET_LINK =
  'inline-flex min-h-11 items-center text-sm font-semibold text-brand underline-offset-4 hover:underline';

/** Characters per group when a key or code is shown, so it can be read and typed in chunks. */
const KEY_GROUP = 4;
const CODE_GROUP = 5;

/** "ABCD EFGH IJKL": easier to type into an app by hand. */
export const grouped = (value: string, size: number): string =>
  value.match(new RegExp(`.{1,${size}}`, 'g'))?.join(' ') ?? value;

/** Saves the codes as a text file, one per line. Runs only in the browser. */
const downloadCodes = (codes: readonly string[]): void => {
  const url = URL.createObjectURL(new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = SETUP_COPY.downloadName;
  link.click();
  URL.revokeObjectURL(url);
};

function RecoveryCodes({ codes }: { codes: readonly string[] }) {
  const [saved, setSaved] = useState(false);
  const checkId = useId();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{SETUP_COPY.savedTitle}</h1>
        <p className="mt-1 text-sm text-subtle">{SETUP_COPY.savedIntro}</p>
      </div>
      <ol className="grid grid-cols-1 gap-2 rounded-2xl bg-warm p-4 font-mono text-sm text-ink sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code} dir="ltr" className="tracking-wide">
            {grouped(code, CODE_GROUP)}
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => downloadCodes(codes)}
        className="inline-flex min-h-11 items-center rounded-xl border border-border bg-white px-4 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
      >
        {SETUP_COPY.download}
      </button>
      <label htmlFor={checkId} className="flex min-h-11 items-center gap-3 text-sm text-ink">
        <input
          id={checkId}
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="size-5 accent-brand"
        />
        {SETUP_COPY.acknowledge}
      </label>
      {saved ? (
        <Link href={ADMIN_ROUTES.signIn} className={PRIMARY}>
          {SETUP_COPY.continue}
        </Link>
      ) : (
        <button type="button" disabled className={PRIMARY}>
          {SETUP_COPY.continue}
        </button>
      )}
      <p className="text-xs text-subtle">{SETUP_COPY.continueHint}</p>
    </div>
  );
}

/** The key on screen: from the confirm step's answer once there is one, else from the start. */
const shownKey = (
  started: MfaSetupState,
  state: MfaSetupState,
): { secret: string; otpauthUri: string } | null => {
  if (state.status === 'error' && state.secret) {
    return { secret: state.secret, otpauthUri: state.otpauthUri ?? '' };
  }
  return started.status === 'ready' ? started : null;
};

/** The latest refusal: the confirm step's, else the start's. */
const errorOf = (started: MfaSetupState, state: MfaSetupState): SignInError | null => {
  if (state.status === 'error') {
    return state.error;
  }
  return started.status === 'error' ? started.error : null;
};

/**
 * First sign-in for a staff member without an authenticator: fetch the key, show it as a QR
 * code and as text, confirm with one code, then show the recovery codes once.
 */
export function MfaSetup({ active }: { active: boolean }) {
  const [started, start, starting] = useActionState(startMfaSetupAction, IDLE);
  const [state, confirm, confirming] = useActionState(enableMfaAction, IDLE);
  const [code, setCode] = useState('');
  const errorId = `${useId()}${FORM_ERROR_ID_SUFFIX}`;

  if (state.status === 'enabled') {
    return <RecoveryCodes codes={state.recoveryCodes} />;
  }

  const shown = shownKey(started, state);
  // No enrolment pending and nothing fetched yet: the sign-in has lapsed, or setup already ended.
  const error = errorOf(started, state) ?? (active || shown ? null : 'expired');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{SETUP_COPY.title}</h1>
        <p className="mt-1 text-sm text-subtle">{SETUP_COPY.intro}</p>
      </div>
      {shown ? (
        <form
          action={confirm}
          onSubmit={(event) => submitKeepingChoices(event, confirm)}
          noValidate
          className="space-y-5"
        >
          <p className="text-sm font-semibold text-ink">{SETUP_COPY.scan}</p>
          <div className="flex justify-center">
            <QrCode value={shown.otpauthUri} label={SETUP_COPY.qrLabel} />
          </div>
          <div>
            <p className="text-sm text-subtle">{SETUP_COPY.manual}</p>
            <p
              dir="ltr"
              className="mt-1 font-mono text-sm tracking-wide break-all text-ink select-all"
            >
              {grouped(shown.secret, KEY_GROUP)}
            </p>
          </div>
          <TextField
            name="code"
            label={SETUP_COPY.code}
            value={code}
            onValueChange={setCode}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={STAFF_CODE_LENGTH}
            invalid={error === 'codeFormat' || error === 'code'}
            errorId={errorId}
            required
          />
          <FormAlert id={errorId} message={error ? SIGN_IN_ERRORS[error] : null} />
          <SubmitButton
            label={SETUP_COPY.confirm}
            pending={SETUP_COPY.confirming}
            busy={confirming}
          />
        </form>
      ) : (
        <>
          <FormAlert id={errorId} message={error ? SIGN_IN_ERRORS[error] : null} />
          {active ? (
            <button
              type="button"
              onClick={() => startTransition(() => start())}
              disabled={starting}
              className={PRIMARY}
            >
              {starting ? SETUP_COPY.starting : SETUP_COPY.start}
            </button>
          ) : null}
        </>
      )}
      <Link href={ADMIN_ROUTES.signIn} className={QUIET_LINK}>
        {SETUP_COPY.back}
      </Link>
    </div>
  );
}
