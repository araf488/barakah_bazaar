'use client';

import { useActionState, useId, useState } from 'react';

import { type SignInState, staffSignInAction } from '../../lib/admin/actions';
import { SIGN_IN_COPY, SIGN_IN_ERRORS } from '../../lib/admin/copy';
import { NEXT_PARAM, SHOP_ROUTES } from '../../lib/admin/routes';
import { FORM_ERROR_ID_SUFFIX, PasswordField, SubmitButton, TextField } from '../auth/fields';
import { submitKeepingChoices } from '../checkout/submitKeepingChoices';
import { FormAlert } from './FormAlert';

const IDLE: SignInState = { status: 'idle' };
const TEXT_LINK =
  'inline-flex min-h-11 items-center text-sm font-semibold text-brand underline-offset-4 hover:underline';

/** The password step. MFA and first-time authenticator setup follow on their own pages. */
export function StaffSignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(staffSignInAction, IDLE);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const errorId = `${useId()}${FORM_ERROR_ID_SUFFIX}`;
  const error = state.status === 'error' ? state.error : null;

  return (
    <form
      action={action}
      onSubmit={(event) => submitKeepingChoices(event, action)}
      noValidate
      className="space-y-5"
    >
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{SIGN_IN_COPY.title}</h1>
        <p className="mt-1 text-sm text-subtle">{SIGN_IN_COPY.intro}</p>
      </div>
      <input type="hidden" name={NEXT_PARAM} value={next} />
      <TextField
        name="email"
        type="email"
        label={SIGN_IN_COPY.email}
        value={email}
        onValueChange={setEmail}
        autoComplete="username"
        invalid={error === 'emailInvalid' || error === 'credentials'}
        errorId={errorId}
        required
      />
      <PasswordField
        name="password"
        label={SIGN_IN_COPY.password}
        value={password}
        onValueChange={setPassword}
        autoComplete="current-password"
        invalid={error === 'passwordMissing' || error === 'credentials'}
        errorId={errorId}
        required
      />
      <FormAlert id={errorId} message={error ? SIGN_IN_ERRORS[error] : null} />
      <SubmitButton label={SIGN_IN_COPY.submit} pending={SIGN_IN_COPY.pending} busy={pending} />
      <div className="flex flex-wrap justify-between gap-2">
        <a href={SHOP_ROUTES.forgotPassword} className={TEXT_LINK}>
          {SIGN_IN_COPY.forgot}
        </a>
        <a href={SHOP_ROUTES.home} className={TEXT_LINK}>
          {SIGN_IN_COPY.shopLink}
        </a>
      </div>
    </form>
  );
}
