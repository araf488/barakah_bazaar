'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type InputHTMLAttributes, type ReactNode, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { AuthFormState } from '../../lib/auth/actions';

const INPUT =
  'min-h-12 w-full rounded-xl border border-border bg-white px-4 text-base text-ink transition placeholder:text-subtle focus:border-brand focus:outline-2 focus:outline-offset-0 focus:outline-brand/30 aria-invalid:border-red-600';

/** The id of the form's error message, so an invalid field can point at it. */
export const FORM_ERROR_ID_SUFFIX = '-error';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  invalid?: boolean;
  errorId?: string;
  hint?: string;
  trailing?: ReactNode;
};

/** A labelled input. Its hint and the form's error are wired up with aria-describedby. */
export function TextField({
  label,
  value,
  onValueChange,
  invalid,
  errorId,
  hint,
  trailing,
  ...input
}: InputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, invalid && errorId ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy || undefined}
          className={`${INPUT} ${trailing ? 'pr-12' : ''}`}
          {...input}
        />
        {trailing}
      </div>
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A password input with a show/hide toggle; the toggle says what it will do. */
export function PasswordField(props: Omit<InputProps, 'type' | 'trailing'>) {
  const t = useTranslations('auth.fields');
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? t('hidePassword') : t('showPassword')}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-subtle transition-colors hover:text-ink"
        >
          <Icon aria-hidden="true" size={18} />
        </button>
      }
    />
  );
}

/**
 * The form's primary action; disabled with a progress label while its action runs. A form that
 * dispatches from `onSubmit` (to skip React's reset) has no form status, so it passes `busy`.
 */
export function SubmitButton({
  label,
  pending,
  busy = false,
}: {
  label: string;
  pending: string;
  busy?: boolean;
}) {
  const status = useFormStatus();
  const running = status.pending || busy;

  return (
    <button
      type="submit"
      disabled={running}
      aria-disabled={running}
      className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-brand px-6 font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-light active:scale-[0.98] disabled:opacity-70"
    >
      {running ? pending : label}
    </button>
  );
}

/** The action's error, announced as it appears. */
export function FormError({ state, id }: { state: AuthFormState; id: string }) {
  const t = useTranslations('auth.errors');
  if (state.status !== 'error') {
    return null;
  }
  return (
    <p
      id={id}
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
    >
      {t(state.error)}
    </p>
  );
}

/** Which field an error is about, so that field is marked invalid. */
export const isFieldError = (state: AuthFormState, ...errors: string[]): boolean =>
  state.status === 'error' && errors.includes(state.error);
