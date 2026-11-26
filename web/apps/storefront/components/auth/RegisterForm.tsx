'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, useState } from 'react';

import { Link } from '../../i18n/navigation';
import { type AuthFormState, registerAction } from '../../lib/auth/actions';
import { PASSWORD_POLICY_ERRORS } from '../../lib/auth/passwordPolicy';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../lib/auth/rules';
import { ROUTES } from '../../lib/routes';
import {
  FORM_ERROR_ID_SUFFIX,
  FormError,
  isFieldError,
  PasswordField,
  SubmitButton,
  TextField,
} from './fields';
import { VerifyEmailForm } from './VerifyEmailForm';

const IDLE: AuthFormState = { status: 'idle' };

/**
 * Name, email and a password the API's policy accepts; a refusal names the rule it broke. On
 * success the visitor moves straight to entering the emailed code; the answer is identical
 * whether or not the address already had an account, as the API intends.
 */
export function RegisterForm() {
  const t = useTranslations('auth');
  const [state, action] = useActionState(registerAction, IDLE);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const errorId = `${useId()}${FORM_ERROR_ID_SUFFIX}`;

  if (state.status === 'sent') {
    return (
      <div className="space-y-5">
        <h1 className="font-display text-2xl font-semibold text-ink">{t('verify.title')}</h1>
        <VerifyEmailForm
          email={state.email}
          intro={t('verify.sentIntro', { email: state.email })}
        />
      </div>
    );
  }

  return (
    <form action={action} noValidate className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{t('register.title')}</h1>
        <p className="mt-1 text-sm text-subtle">{t('register.intro')}</p>
      </div>
      <TextField
        name="fullName"
        label={t('fields.fullName')}
        value={fullName}
        onValueChange={setFullName}
        autoComplete="name"
        maxLength={120}
        invalid={isFieldError(state, 'nameMissing')}
        errorId={errorId}
        required
      />
      <TextField
        name="email"
        type="email"
        label={t('fields.email')}
        value={email}
        onValueChange={setEmail}
        autoComplete="email"
        invalid={isFieldError(state, 'emailInvalid')}
        errorId={errorId}
        required
      />
      <PasswordField
        name="password"
        label={t('fields.password')}
        value={password}
        onValueChange={setPassword}
        autoComplete="new-password"
        hint={t('fields.passwordHint')}
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        invalid={isFieldError(state, ...PASSWORD_POLICY_ERRORS)}
        errorId={errorId}
        required
      />
      <PasswordField
        name="confirm"
        label={t('fields.confirm')}
        value={confirm}
        onValueChange={setConfirm}
        autoComplete="new-password"
        invalid={isFieldError(state, 'passwordMismatch')}
        errorId={errorId}
        required
      />
      <FormError state={state} id={errorId} />
      <SubmitButton label={t('register.submit')} pending={t('register.pending')} />
      <p className="text-center text-sm text-subtle">
        {t('register.haveAccount')}{' '}
        <Link
          href={ROUTES.signIn}
          className="inline-flex min-h-11 min-w-11 items-center justify-center font-semibold text-brand underline-offset-4 hover:underline"
        >
          {t('register.signIn')}
        </Link>
      </p>
    </form>
  );
}
