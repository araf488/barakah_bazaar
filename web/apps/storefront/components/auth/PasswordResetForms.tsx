'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, useState } from 'react';

import { Link } from '../../i18n/navigation';
import {
  type AuthFormState,
  forgotPasswordAction,
  resetPasswordAction,
} from '../../lib/auth/actions';
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
import { Success } from './VerifyEmailForm';

const IDLE: AuthFormState = { status: 'idle' };
const TEXT_LINK =
  'inline-flex min-h-11 min-w-11 items-center justify-center font-semibold text-brand underline-offset-4 hover:underline';

/** Asks for a reset email; the answer is the same for every address, as the API intends. */
export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const [state, action] = useActionState(forgotPasswordAction, IDLE);
  const [email, setEmail] = useState('');
  const errorId = `${useId()}${FORM_ERROR_ID_SUFFIX}`;

  if (state.status === 'sent') {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm leading-relaxed text-ink">
          {t('forgot.sent', { email: state.email })}
        </p>
        <Link href={ROUTES.resetPassword} className={TEXT_LINK}>
          {t('reset.title')}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} noValidate className="space-y-5">
      <p className="text-sm text-subtle">{t('forgot.intro')}</p>
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
      <FormError state={state} id={errorId} />
      <SubmitButton label={t('forgot.submit')} pending={t('forgot.pending')} />
      <p className="text-center text-sm">
        <Link href={ROUTES.signIn} className={TEXT_LINK}>
          {t('forgot.back')}
        </Link>
      </p>
    </form>
  );
}

/**
 * A new password, by emailed link (`?token=`) or by email and code. The API signs out every
 * other device and returns no session, so the visitor signs in again afterwards.
 */
export function ResetPasswordForm({ token }: { token?: string }) {
  const t = useTranslations('auth');
  const [state, action] = useActionState(resetPasswordAction, IDLE);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const errorId = `${useId()}${FORM_ERROR_ID_SUFFIX}`;

  if (state.status === 'done') {
    return <Success message={t('reset.done')} cta={t('reset.signIn')} />;
  }

  return (
    <form action={action} noValidate className="space-y-5">
      <p className="text-sm text-subtle">{token ? t('reset.intro') : t('reset.codeIntro')}</p>
      {token ? (
        <input type="hidden" name="token" value={token} />
      ) : (
        <>
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
          <TextField
            name="code"
            label={t('fields.code')}
            value={code}
            onValueChange={setCode}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            invalid={isFieldError(state, 'codeInvalid')}
            errorId={errorId}
            required
          />
        </>
      )}
      <PasswordField
        name="password"
        label={t('fields.newPassword')}
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
      <SubmitButton label={t('reset.submit')} pending={t('reset.pending')} />
    </form>
  );
}
