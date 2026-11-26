'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';

import { type SignInState, verifyStaffCodeAction } from '../../lib/admin/actions';
import { SIGN_IN_ERRORS, VERIFY_COPY } from '../../lib/admin/copy';
import { ADMIN_ROUTES, NEXT_PARAM } from '../../lib/admin/routes';
import { RECOVERY_CODE_LENGTH, STAFF_CODE_LENGTH } from '../../lib/admin/rules';
import { FORM_ERROR_ID_SUFFIX, SubmitButton, TextField } from '../auth/fields';
import { submitKeepingChoices } from '../checkout/submitKeepingChoices';
import { FormAlert } from './FormAlert';

const IDLE: SignInState = { status: 'idle' };
const QUIET_LINK =
  'inline-flex min-h-11 items-center text-sm font-semibold text-brand underline-offset-4 hover:underline';

type Method = 'code' | 'recovery';

/** The second sign-in step: the authenticator's code, or a recovery code when the phone is gone. */
export function StaffCodeForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(verifyStaffCodeAction, IDLE);
  const [method, setMethod] = useState<Method>('code');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const errorId = `${useId()}${FORM_ERROR_ID_SUFFIX}`;
  const error = state.status === 'error' ? state.error : null;
  const recovery = method === 'recovery';

  return (
    <form
      action={action}
      onSubmit={(event) => submitKeepingChoices(event, action)}
      noValidate
      className="space-y-5"
    >
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{VERIFY_COPY.title}</h1>
        <p className="mt-1 text-sm text-subtle">
          {recovery ? VERIFY_COPY.recoveryIntro : VERIFY_COPY.intro}
        </p>
      </div>
      <input type="hidden" name={NEXT_PARAM} value={next} />
      <input type="hidden" name="method" value={method} />
      {recovery ? (
        <TextField
          key="recovery"
          name="recoveryCode"
          label={VERIFY_COPY.recoveryCode}
          value={recoveryCode}
          onValueChange={setRecoveryCode}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={RECOVERY_CODE_LENGTH * 2}
          invalid={error === 'recoveryFormat' || error === 'code'}
          errorId={errorId}
          autoFocus
          required
        />
      ) : (
        <TextField
          key="code"
          name="code"
          label={VERIFY_COPY.code}
          value={code}
          onValueChange={setCode}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={STAFF_CODE_LENGTH}
          invalid={error === 'codeFormat' || error === 'code'}
          errorId={errorId}
          autoFocus
          required
        />
      )}
      <FormAlert id={errorId} message={error ? SIGN_IN_ERRORS[error] : null} />
      <SubmitButton label={VERIFY_COPY.submit} pending={VERIFY_COPY.pending} busy={pending} />
      <div className="flex flex-wrap justify-between gap-2">
        <button
          type="button"
          onClick={() => setMethod(recovery ? 'code' : 'recovery')}
          className={QUIET_LINK}
        >
          {recovery ? VERIFY_COPY.useCode : VERIFY_COPY.useRecovery}
        </button>
        <Link href={ADMIN_ROUTES.signIn} className={QUIET_LINK}>
          {VERIFY_COPY.back}
        </Link>
      </div>
    </form>
  );
}
