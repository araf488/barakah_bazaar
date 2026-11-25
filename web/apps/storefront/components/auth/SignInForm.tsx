'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, useState } from 'react';

import { Link } from '../../i18n/navigation';
import { type AuthFormState, signInAction, verifyMfaAction } from '../../lib/auth/actions';
import { ROUTES } from '../../lib/routes';
import {
  FORM_ERROR_ID_SUFFIX,
  FormError,
  isFieldError,
  PasswordField,
  SubmitButton,
  TextField,
} from './fields';

const IDLE: AuthFormState = { status: 'idle' };
const TEXT_LINK = 'font-semibold text-brand underline-offset-4 hover:underline';

/** Second step for an account with two-step verification: an app code or a recovery code. */
function MfaStep({ next, onRestart }: { next: string; onRestart: () => void }) {
  const t = useTranslations('auth');
  const [state, action] = useActionState(verifyMfaAction, IDLE);
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const errorId = `${useId()}${FORM_ERROR_ID_SUFFIX}`;

  return (
    <form action={action} noValidate className="space-y-5">
      <h1 className="font-display text-2xl font-semibold text-ink">{t('mfa.title')}</h1>
      <p className="text-sm text-subtle">{t('mfa.intro')}</p>
      <input type="hidden" name="next" value={next} />
      {useRecovery ? (
        <TextField
          name="recoveryCode"
          label={t('fields.recoveryCode')}
          value={value}
          onValueChange={setValue}
          autoComplete="off"
          required
        />
      ) : (
        <TextField
          name="code"
          label={t('fields.code')}
          value={value}
          onValueChange={setValue}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          invalid={isFieldError(state, 'codeInvalid', 'code')}
          errorId={errorId}
          required
        />
      )}
      <FormError state={state} id={errorId} />
      <SubmitButton label={t('mfa.submit')} pending={t('mfa.pending')} />
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button
          type="button"
          onClick={() => {
            setUseRecovery((on) => !on);
            setValue('');
          }}
          className={`min-h-11 ${TEXT_LINK}`}
        >
          {useRecovery ? t('mfa.useCode') : t('mfa.useRecovery')}
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="min-h-11 text-subtle underline-offset-4 hover:text-ink hover:underline"
        >
          {t('mfa.restart')}
        </button>
      </div>
    </form>
  );
}

/** Email and password, then the code step when the account has two-step verification on. */
export function SignInForm({ next }: { next: string }) {
  const t = useTranslations('auth');
  const [state, action] = useActionState(signInAction, IDLE);
  const [restarted, setRestarted] = useState<AuthFormState | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const errorId = `${useId()}${FORM_ERROR_ID_SUFFIX}`;

  if (state.status === 'mfa' && restarted !== state) {
    return (
      <MfaStep
        next={next}
        onRestart={() => {
          setRestarted(state);
          setPassword('');
        }}
      />
    );
  }

  return (
    <form action={action} noValidate className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{t('signIn.title')}</h1>
        <p className="mt-1 text-sm text-subtle">{t('signIn.intro')}</p>
      </div>
      <input type="hidden" name="next" value={next} />
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
      <div>
        <PasswordField
          name="password"
          label={t('fields.password')}
          value={password}
          onValueChange={setPassword}
          autoComplete="current-password"
          invalid={isFieldError(state, 'credentials')}
          errorId={errorId}
          required
        />
        <p className="mt-1.5 text-right text-sm">
          <Link
            href={ROUTES.forgotPassword}
            className={`inline-flex min-h-11 min-w-11 items-center justify-center ${TEXT_LINK}`}
          >
            {t('signIn.forgot')}
          </Link>
        </p>
      </div>
      <FormError state={state} id={errorId} />
      <SubmitButton label={t('signIn.submit')} pending={t('signIn.pending')} />
      <p className="text-center text-sm text-subtle">
        {t('signIn.noAccount')}{' '}
        <Link
          href={ROUTES.register}
          className={`inline-flex min-h-11 min-w-11 items-center justify-center ${TEXT_LINK}`}
        >
          {t('signIn.register')}
        </Link>
      </p>
    </form>
  );
}
