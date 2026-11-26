'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';

import { acceptInvitationAction, type InvitationState } from '../../lib/admin/actions';
import {
  INVITATION_COPY,
  INVITATION_ERRORS,
  type InvitationError,
  PASSWORD_HINT,
} from '../../lib/admin/copy';
import { ADMIN_ROUTES } from '../../lib/admin/routes';
import { PASSWORD_POLICY_ERRORS } from '../../lib/auth/passwordPolicy';
import {
  FULL_NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../lib/auth/rules';
import { FORM_ERROR_ID_SUFFIX, PasswordField, SubmitButton, TextField } from '../auth/fields';
import { submitKeepingChoices } from '../checkout/submitKeepingChoices';
import { FormAlert } from './FormAlert';

const IDLE: InvitationState = { status: 'idle' };
const PRIMARY =
  'flex min-h-12 w-full items-center justify-center rounded-2xl bg-brand px-6 font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-light';

const PASSWORD_ERRORS: readonly InvitationError[] = PASSWORD_POLICY_ERRORS;

/**
 * The page an invitation email opens: a name and a password make the staff account. Signing in,
 * and setting up the authenticator, come after.
 */
export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvitationAction, IDLE);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const errorId = `${useId()}${FORM_ERROR_ID_SUFFIX}`;
  const error = state.status === 'error' ? state.error : null;

  if (state.status === 'accepted') {
    return (
      <div className="space-y-5">
        <h1 className="font-display text-2xl font-semibold text-ink">
          {INVITATION_COPY.acceptedTitle}
        </h1>
        <p role="status" className="text-sm text-subtle">
          {INVITATION_COPY.acceptedIntro}
        </p>
        <Link href={ADMIN_ROUTES.signIn} className={PRIMARY}>
          {INVITATION_COPY.signIn}
        </Link>
      </div>
    );
  }

  return (
    <form
      action={action}
      onSubmit={(event) => submitKeepingChoices(event, action)}
      noValidate
      className="space-y-5"
    >
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{INVITATION_COPY.title}</h1>
        <p className="mt-1 text-sm text-subtle">{INVITATION_COPY.intro}</p>
      </div>
      <input type="hidden" name="token" value={token} />
      <TextField
        name="fullName"
        label={INVITATION_COPY.fullName}
        value={fullName}
        onValueChange={setFullName}
        autoComplete="name"
        maxLength={FULL_NAME_MAX_LENGTH}
        invalid={error === 'nameMissing'}
        errorId={errorId}
        required
      />
      <PasswordField
        name="password"
        label={INVITATION_COPY.password}
        value={password}
        onValueChange={setPassword}
        autoComplete="new-password"
        hint={PASSWORD_HINT}
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        invalid={error !== null && PASSWORD_ERRORS.includes(error)}
        errorId={errorId}
        required
      />
      <PasswordField
        name="confirm"
        label={INVITATION_COPY.confirm}
        value={confirm}
        onValueChange={setConfirm}
        autoComplete="new-password"
        invalid={error === 'passwordMismatch'}
        errorId={errorId}
        required
      />
      <FormAlert id={errorId} message={error ? INVITATION_ERRORS[error] : null} />
      <SubmitButton
        label={INVITATION_COPY.submit}
        pending={INVITATION_COPY.pending}
        busy={pending}
      />
    </form>
  );
}
