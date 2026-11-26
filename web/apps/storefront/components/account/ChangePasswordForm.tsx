'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, useState } from 'react';

import type { PasswordChangeError } from '../../lib/account/passwordChange';
import { changePasswordAction, type PasswordChangeState } from '../../lib/account/securityActions';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../lib/auth/rules';
import { FORM_ERROR_ID_SUFFIX, PasswordField, SubmitButton } from '../auth/fields';

const IDLE: PasswordChangeState = { status: 'idle' };

/** Which field each refusal is about, so that field is marked invalid. */
const CURRENT_ERRORS: readonly PasswordChangeError[] = ['currentMissing', 'currentWrong'];
const CONFIRM_ERRORS: readonly PasswordChangeError[] = ['passwordMismatch'];
const NEW_PASSWORD_ERRORS: readonly PasswordChangeError[] = [
  'passwordShort',
  'passwordLong',
  'passwordSame',
  'passwordCommon',
  'passwordIdentity',
  'passwordShopName',
  'passwordDistinct',
  'passwordSequential',
  'passwordClasses',
];

const errorIn = (state: PasswordChangeState, errors: readonly PasswordChangeError[]): boolean =>
  state.status === 'error' && errors.includes(state.error);

/**
 * The current password and a new one, twice. The fields keep what was typed after a refusal and
 * empty after a change; the API signs every other device out, and the page redraws the list.
 */
export function ChangePasswordForm() {
  const t = useTranslations('security.password');
  const [state, action] = useActionState(changePasswordAction, IDLE);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [handled, setHandled] = useState(state);
  const errorId = `${useId()}${FORM_ERROR_ID_SUFFIX}`;

  // A new answer from the action: a successful change clears every field.
  if (handled !== state) {
    setHandled(state);
    if (state.status === 'changed') {
      setCurrent('');
      setNext('');
      setConfirm('');
    }
  }

  return (
    <form action={action} noValidate className="max-w-md space-y-5">
      <PasswordField
        name="currentPassword"
        label={t('current')}
        value={current}
        onValueChange={setCurrent}
        autoComplete="current-password"
        maxLength={PASSWORD_MAX_LENGTH}
        invalid={errorIn(state, CURRENT_ERRORS)}
        errorId={errorId}
        required
      />
      <PasswordField
        name="newPassword"
        label={t('new')}
        value={next}
        onValueChange={setNext}
        autoComplete="new-password"
        hint={t('hint')}
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        invalid={errorIn(state, NEW_PASSWORD_ERRORS)}
        errorId={errorId}
        required
      />
      <PasswordField
        name="confirmPassword"
        label={t('confirm')}
        value={confirm}
        onValueChange={setConfirm}
        autoComplete="new-password"
        maxLength={PASSWORD_MAX_LENGTH}
        invalid={errorIn(state, CONFIRM_ERRORS)}
        errorId={errorId}
        required
      />
      {state.status === 'error' ? (
        <p
          key={state.at}
          id={errorId}
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      {state.status === 'changed' ? (
        <p
          key={state.at}
          role="status"
          className="rounded-xl bg-warm px-4 py-3 text-sm font-medium text-ink"
        >
          {t('changed')}
        </p>
      ) : null}
      <SubmitButton label={t('submit')} pending={t('pending')} />
    </form>
  );
}
