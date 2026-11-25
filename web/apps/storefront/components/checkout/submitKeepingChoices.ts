import { type FormEvent, startTransition } from 'react';

/**
 * Submits a form to its action without React's automatic reset afterwards. A refused order must
 * keep the delivery time, note and price confirmation the shopper chose (the radios and note are
 * joined to the form from the page, so a reset would clear them too), and a refused promo code
 * stays in its field to correct. Forms keep their `action` for a submit before hydration.
 */
export const submitKeepingChoices = (
  event: FormEvent<HTMLFormElement>,
  dispatch: (form: FormData) => void,
): void => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  startTransition(() => dispatch(data));
};
