'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, useState } from 'react';

import { Link } from '../../i18n/navigation';
import {
  type AuthFormState,
  resendVerificationAction,
  verifyEmailAction,
} from '../../lib/auth/actions';
import { ROUTES } from '../../lib/routes';
import { FORM_ERROR_ID_SUFFIX, FormError, isFieldError, SubmitButton, TextField } from './fields';

const IDLE: AuthFormState = { status: 'idle' };

/** Shown once the email is confirmed. */
export function Success({ message, cta }: { message: string; cta: string }) {
  return (
    <div className="space-y-6 text-center">
      <p role="status" className="text-sm leading-relaxed text-ink">
        {message}
      </p>
      <Link
        href={ROUTES.signIn}
        className="flex min-h-12 items-center justify-center rounded-2xl bg-brand px-6 font-semibold text-white transition hover:bg-brand-light active:scale-[0.98]"
      >
        {cta}
      </Link>
    </div>
  );
}

/** Asks for a new link; the answer is the same whether or not the address has an account. */
function ResendForm({ email: initialEmail }: { email: string }) {
  const t = useTranslations('auth');
  const [state, action] = useActionState(resendVerificationAction, IDLE);
  const [email, setEmail] = useState(initialEmail);
  const errorId = `${useId()}${FORM_ERROR_ID_SUFFIX}`;

  if (state.status === 'sent') {
    return (
      <p role="status" className="text-sm text-subtle">
        {t('verify.resent')}
      </p>
    );
  }
  return (
    <form action={action} noValidate className="space-y-3 border-t border-border pt-6">
      {initialEmail ? (
        <input type="hidden" name="email" value={email} />
      ) : (
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
      )}
      <FormError state={state} id={errorId} />
      <button
        type="submit"
        className="min-h-11 text-sm font-semibold text-brand underline-offset-4 hover:underline"
      >
        {t('verify.resend')}
      </button>
    </form>
  );
}

interface VerifyEmailFormProps {
  /** From the emailed link; the page only confirms it when the visitor presses the button. */
  token?: string;
  email?: string;
  intro: string;
}

/**
 * Confirms an email address, from the emailed link (`?token=`) or by typing the 6-digit code.
 * A link is never confirmed on page load: mail scanners open links, and a GET must not act.
 */
export function VerifyEmailForm({ token, email: initialEmail = '', intro }: VerifyEmailFormProps) {
  const t = useTranslations('auth');
  const [state, action] = useActionState(verifyEmailAction, IDLE);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const errorId = `${useId()}${FORM_ERROR_ID_SUFFIX}`;

  if (state.status === 'done') {
    return <Success message={t('verify.done')} cta={t('verify.signIn')} />;
  }

  return (
    <div className="space-y-6">
      <form action={action} noValidate className="space-y-5">
        <p className="text-sm leading-relaxed text-subtle">{intro}</p>
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
              invalid={isFieldError(state, 'codeInvalid', 'invalid')}
              errorId={errorId}
              required
            />
          </>
        )}
        <FormError state={state} id={errorId} />
        <SubmitButton
          label={token ? t('verify.submitLink') : t('verify.submitCode')}
          pending={t('verify.pending')}
        />
      </form>
      <ResendForm email={initialEmail} />
    </div>
  );
}
