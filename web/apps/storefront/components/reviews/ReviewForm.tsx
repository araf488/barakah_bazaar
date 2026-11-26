'use client';

import { formatCount } from '@barakah/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useId, useState } from 'react';

import type { StorefrontLocale } from '../../i18n/messages';
import { type ReviewFormState, submitReviewAction } from '../../lib/reviews/actions';
import {
  REVIEW_BODY_MAX_LENGTH,
  REVIEW_TITLE_MAX_LENGTH,
  type ReviewFormError,
} from '../../lib/reviews/rules';
import { FORM_ERROR_ID_SUFFIX, SubmitButton, TextField } from '../auth/fields';
import { submitKeepingChoices } from '../checkout/submitKeepingChoices';
import { RatingInput } from './RatingInput';

const IDLE: ReviewFormState = { status: 'idle' };

const TEXTAREA =
  'w-full resize-y rounded-xl border border-border bg-white px-4 py-3 text-base text-ink transition focus:border-brand focus:outline-2 focus:outline-offset-0 focus:outline-brand/30 aria-invalid:border-red-600';

const errorIs = (state: ReviewFormState, error: ReviewFormError): boolean =>
  state.status === 'error' && state.error === error;

/**
 * A star rating, an optional headline and optional text for one delivered line. A refusal keeps
 * the chosen stars and what was typed (React would otherwise reset the form after its action);
 * a sent review reloads the page with a thank-you.
 */
export function ReviewForm({ orderItemId }: { orderItemId: string }) {
  const t = useTranslations('myReviews.form');
  const locale = useLocale() as StorefrontLocale;
  const [state, action, pending] = useActionState(submitReviewAction, IDLE);
  const [rating, setRating] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const id = useId();
  const errorId = `${id}${FORM_ERROR_ID_SUFFIX}`;
  const bodyId = `${id}-body`;
  const bodyHintId = `${id}-body-hint`;
  const bodyInvalid = errorIs(state, 'bodyLong');

  return (
    <form
      action={action}
      onSubmit={(event) => submitKeepingChoices(event, action)}
      noValidate
      className="space-y-5"
    >
      <input type="hidden" name="orderItemId" value={orderItemId} />
      <RatingInput
        value={rating}
        onChange={setRating}
        invalid={errorIs(state, 'ratingMissing')}
        errorId={errorId}
      />
      <TextField
        name="title"
        label={t('titleLabel')}
        value={title}
        onValueChange={setTitle}
        maxLength={REVIEW_TITLE_MAX_LENGTH}
        invalid={errorIs(state, 'titleLong')}
        errorId={errorId}
      />
      <div>
        <label htmlFor={bodyId} className="mb-1.5 block text-sm font-semibold text-ink">
          {t('bodyLabel')}
        </label>
        <textarea
          id={bodyId}
          name="body"
          rows={5}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={REVIEW_BODY_MAX_LENGTH}
          aria-invalid={bodyInvalid || undefined}
          aria-describedby={[bodyHintId, bodyInvalid ? errorId : null].filter(Boolean).join(' ')}
          className={TEXTAREA}
        />
        <div className="mt-1.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-subtle">
          <p id={bodyHintId}>{t('bodyHint')}</p>
          <p>
            {t('characters', {
              used: formatCount(body.length, locale),
              max: formatCount(REVIEW_BODY_MAX_LENGTH, locale),
            })}
          </p>
        </div>
      </div>
      {state.status === 'error' ? (
        <p
          id={errorId}
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      <SubmitButton label={t('submit')} pending={t('pending')} busy={pending} />
    </form>
  );
}
