import { useLocale, useTranslations } from 'next-intl';

import type { SlotOccurrence } from '../../lib/checkout/api';
import {
  formatSlotDate,
  formatSlotTime,
  groupSlotsByDate,
  NO_SLOT,
  slotValue,
} from '../../lib/checkout/slots';
import { PLACE_ORDER_FORM_ID } from './formId';

/** A window this close to full says how many places are left. */
const FEW_PLACES_LEFT = 3;

const OPTION_BASE =
  'flex min-h-11 cursor-pointer rounded-xl border border-border bg-white px-3 py-2 text-sm transition hover:border-brand has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-white has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-warm has-[:disabled]:text-subtle has-[:disabled]:hover:border-border has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand';

const OPTION = `${OPTION_BASE} flex-col justify-center`;

function SlotOption({ slot }: { slot: SlotOccurrence }) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const full = slot.remaining <= 0;
  const few = !full && slot.remaining <= FEW_PLACES_LEFT;

  return (
    <label className={OPTION}>
      <input
        type="radio"
        name="slot"
        value={slotValue(slot)}
        disabled={full}
        form={PLACE_ORDER_FORM_ID}
        className="sr-only"
      />
      <span className="font-medium">
        {formatSlotTime(slot.startMinute, slot.endMinute, locale)}
      </span>
      {full || few ? (
        <span className="text-xs">
          {full ? t('slotFull') : t('slotLeft', { count: slot.remaining })}
        </span>
      ) : null}
    </label>
  );
}

/**
 * The delivery windows for the chosen address, by day, plus "no preferred time" (the API's
 * default: a window is optional). Full windows stay visible but cannot be picked.
 */
export function SlotPicker({ slots }: { slots: SlotOccurrence[] }) {
  const t = useTranslations('checkout');
  const locale = useLocale();
  const days = groupSlotsByDate(slots);

  return (
    <div className="space-y-4">
      <label className={`${OPTION_BASE} items-center`}>
        <input
          type="radio"
          name="slot"
          value={NO_SLOT}
          defaultChecked
          form={PLACE_ORDER_FORM_ID}
          className="sr-only"
        />
        <span>
          <span className="block font-medium">{t('slotAny')}</span>
          <span className="block text-xs opacity-80">{t('slotAnyHint')}</span>
        </span>
      </label>
      {days.length === 0 ? <p className="text-sm text-subtle">{t('slotNone')}</p> : null}
      {days.map((day) => (
        <fieldset key={day.date}>
          <legend className="mb-2 text-sm font-semibold text-ink">
            {formatSlotDate(day.date, locale)}
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {day.slots.map((slot) => (
              <SlotOption key={slotValue(slot)} slot={slot} />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
