import { Check, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import type { Order } from '../../lib/checkout/api';
import { formatOrderMoment } from '../../lib/orders/format';
import { buildTimeline, type StepState, type TimelineStep } from '../../lib/orders/timeline';

const MARKER: Record<StepState, string> = {
  done: 'border-brand bg-brand text-white',
  current: 'border-brand bg-white',
  upcoming: 'border-border bg-white',
  stopped: 'border-red-600 bg-red-600 text-white',
};

function Marker({ state }: { state: StepState }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${MARKER[state]}`}
    >
      {state === 'done' ? <Check size={14} strokeWidth={3} /> : null}
      {state === 'current' ? <span className="size-2.5 rounded-full bg-brand" /> : null}
      {state === 'stopped' ? <X size={14} strokeWidth={3} /> : null}
    </span>
  );
}

function Step({ step, last }: { step: TimelineStep; last: boolean }) {
  const t = useTranslations('orders');
  const locale = useLocale();
  const reached = step.state !== 'upcoming';
  return (
    <li aria-current={step.state === 'current' ? 'step' : undefined} className="flex gap-3">
      <span className="flex flex-col items-center">
        <Marker state={step.state} />
        {last ? null : (
          <span
            aria-hidden="true"
            className={`my-1 w-0.5 flex-1 ${step.state === 'done' ? 'bg-brand/40' : 'bg-border'}`}
          />
        )}
      </span>
      <div className={last ? 'pb-0' : 'pb-5'}>
        <p className={`text-sm font-semibold ${reached ? 'text-ink' : 'text-subtle'}`}>
          {t(`status.${step.status}`)}
          <span className="sr-only"> ({t(`stepState.${step.state}`)})</span>
        </p>
        {step.at ? (
          <p className="text-xs text-subtle">{formatOrderMoment(step.at, locale)}</p>
        ) : null}
        {reached ? (
          <p className="mt-0.5 text-sm text-subtle">{t(`stepNote.${step.status}`)}</p>
        ) : null}
        {step.note ? (
          <p className="mt-1 text-sm text-ink">
            <span className="font-medium">{t('detail.reason')}: </span>
            {step.note}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** Where the order has been and where it is now, step by step, from its recorded history. */
export function OrderTimeline({ order }: { order: Order }) {
  const steps = buildTimeline(order);
  return (
    <ol className="mt-2">
      {steps.map((step, index) => (
        <Step key={step.status} step={step} last={index === steps.length - 1} />
      ))}
    </ol>
  );
}
