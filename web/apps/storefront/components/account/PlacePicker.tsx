'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import {
  fetchAreas,
  fetchDistricts,
  fetchDivisions,
  fetchUnits,
  type GeoArea,
  type GeoPlace,
} from '../../lib/geo';
import { type PlacesState, usePlaces } from './usePlaces';

export interface PlaceValue {
  division: string;
  district: string;
  unit: string;
  area: string;
}

const SELECT =
  'min-h-12 w-full rounded-xl border border-border bg-white px-3 text-base text-ink transition focus:border-brand focus:outline-2 focus:outline-brand/30 disabled:bg-warm disabled:text-subtle aria-invalid:border-red-600';

interface SelectProps {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  places: PlacesState<GeoPlace> & { retry: () => void };
  disabled: boolean;
  invalid: boolean;
  errorId?: string;
}

/** A labelled native select: on phones it opens the system picker, which handles long lists well. */
function PlaceSelect({
  name,
  label,
  value,
  onChange,
  places,
  disabled,
  invalid,
  errorId,
}: SelectProps) {
  const t = useTranslations('address');
  const locale = useLocale();
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink">
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || places.status === 'loading'}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && errorId ? errorId : undefined}
        aria-busy={places.status === 'loading' || undefined}
        className={SELECT}
      >
        <option value="">
          {places.status === 'loading' ? t('places.loading') : t('fields.choose')}
        </option>
        {places.items.map((place) => (
          <option key={place.nameEn} value={place.nameEn}>
            {locale === 'bn' && place.nameBn ? place.nameBn : place.nameEn}
          </option>
        ))}
      </select>
      {places.status === 'error' ? (
        <p role="alert" className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-red-800">
          {t('places.error')}
          <button
            type="button"
            onClick={places.retry}
            className="inline-flex min-h-11 items-center font-semibold text-brand underline"
          >
            {t('places.retry')}
          </button>
        </p>
      ) : null}
    </div>
  );
}

function FreeText({
  name,
  label,
  value,
  onChange,
  maxLength,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength: number;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        name={name}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className={SELECT}
      />
    </div>
  );
}

interface ListedLowerProps {
  value: PlaceValue;
  units: PlacesState<GeoPlace> & { retry: () => void };
  areas: PlacesState<GeoArea> & { retry: () => void };
  choose: (level: keyof PlaceValue, next: string) => void;
  unitInvalid: boolean;
  errorId: string;
}

/** Upazila or thana, then area; the area select is left out where the list has none. */
function ListedLower({ value, units, areas, choose, unitInvalid, errorId }: ListedLowerProps) {
  const t = useTranslations('address');
  return (
    <>
      <PlaceSelect
        name="unit"
        label={t('fields.unit')}
        value={value.unit}
        onChange={(v) => choose('unit', v)}
        places={units}
        disabled={!value.district}
        invalid={unitInvalid}
        errorId={errorId}
      />
      {areas.status === 'ready' && areas.items.length === 0 ? null : (
        <PlaceSelect
          name="area"
          label={t('fields.area')}
          value={value.area}
          onChange={(v) => choose('area', v)}
          places={areas}
          disabled={!value.unit}
          invalid={false}
        />
      )}
    </>
  );
}

function UnlistedToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useTranslations('address');
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
      <input
        type="checkbox"
        name="unlistedLocation"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 accent-brand"
      />
      {t('fields.unlisted')}
    </label>
  );
}

interface PlacePickerProps {
  initial: PlaceValue;
  initialUnlisted: boolean;
  /** Called with the chosen area, so the form can fill in its post code. */
  onArea: (area: GeoArea | null) => void;
  invalid: boolean;
  errorId: string;
}

/** Longest place name the API accepts (UserConstants.MaxGeoNameLength). */
const MAX_PLACE_LENGTH = 80;

/**
 * Division, district, upazila or thana, then area: each list loads once the level above is
 * chosen, in the reader's language, and submits the English name the API validates. When the
 * customer's area is missing, "not in the list" keeps division and district (which delivery
 * routing needs) and turns the lower two into free text, as the API allows.
 */
export function PlacePicker({
  initial,
  initialUnlisted,
  onArea,
  invalid,
  errorId,
}: PlacePickerProps) {
  const t = useTranslations('address');
  const [value, setValue] = useState<PlaceValue>(initial);
  const [unlisted, setUnlisted] = useState(initialUnlisted);

  const divisions = usePlaces(fetchDivisions, 'root');
  const districts = usePlaces(
    value.division ? () => fetchDistricts(value.division) : null,
    value.division,
  );
  const units = usePlaces(
    !unlisted && value.district ? () => fetchUnits(value.district) : null,
    `${value.district}|${unlisted}`,
  );
  const areas = usePlaces(
    !unlisted && value.unit ? () => fetchAreas(value.district, value.unit) : null,
    `${value.district}|${value.unit}|${unlisted}`,
  );

  const choose = (level: keyof PlaceValue, next: string) => {
    const order: (keyof PlaceValue)[] = ['division', 'district', 'unit', 'area'];
    const cleared = Object.fromEntries(
      order.slice(order.indexOf(level) + 1).map((key) => [key, '']),
    );
    setValue((current) => ({ ...current, ...cleared, [level]: next }));
    if (level === 'area') {
      onArea(areas.items.find((area) => area.nameEn === next) ?? null);
    }
  };

  const missing = (key: keyof PlaceValue) => invalid && !value[key];
  const setText = (key: 'unit' | 'area') => (next: string) =>
    setValue((c) => ({ ...c, [key]: next }));

  return (
    <fieldset className="space-y-4">
      <PlaceSelect
        name="division"
        label={t('fields.division')}
        value={value.division}
        onChange={(v) => choose('division', v)}
        places={divisions}
        disabled={false}
        invalid={missing('division')}
        errorId={errorId}
      />
      <PlaceSelect
        name="district"
        label={t('fields.district')}
        value={value.district}
        onChange={(v) => choose('district', v)}
        places={districts}
        disabled={!value.division}
        invalid={missing('district')}
        errorId={errorId}
      />
      {unlisted ? (
        <>
          <FreeText
            name="unit"
            label={t('fields.unitText')}
            value={value.unit}
            onChange={setText('unit')}
            maxLength={MAX_PLACE_LENGTH}
          />
          <FreeText
            name="area"
            label={t('fields.areaText')}
            value={value.area}
            onChange={setText('area')}
            maxLength={MAX_PLACE_LENGTH}
          />
        </>
      ) : (
        <ListedLower
          value={value}
          units={units}
          areas={areas}
          choose={choose}
          unitInvalid={missing('unit')}
          errorId={errorId}
        />
      )}
      <UnlistedToggle
        checked={unlisted}
        onChange={(checked) => {
          setUnlisted(checked);
          setValue((c) => ({ ...c, unit: '', area: '' }));
          onArea(null);
        }}
      />
    </fieldset>
  );
}
