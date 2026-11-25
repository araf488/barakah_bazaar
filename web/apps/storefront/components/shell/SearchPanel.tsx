'use client';

import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { RefObject } from 'react';

import { SearchResults } from './SearchResults';
import { type SearchState, useProductSearch } from './useProductSearch';

/**
 * Starter queries shown before the visitor types. Keys are message keys (the chip label);
 * values are what gets searched, in English because product names are English-led and the
 * API's Bangla search is still weak (src/modules/search/README.md).
 */
export const SEARCH_SUGGESTIONS = {
  ajwa: 'Ajwa',
  medjool: 'Medjool',
  doi: 'Doi',
  rosmalai: 'Rosmalai',
  cashew: 'Cashew',
} as const;

type SuggestionKey = keyof typeof SEARCH_SUGGESTIONS;

const ESCAPE_KEY = 'Escape';

interface SearchPanelProps {
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

function Suggestions({ onPick }: { onPick: (query: string) => void }) {
  const t = useTranslations('search');
  const keys = Object.keys(SEARCH_SUGGESTIONS) as SuggestionKey[];

  return (
    <div className="p-5">
      <p className="mb-3 text-xs font-semibold text-subtle">{t('suggestionsHeading')}</p>
      <ul className="flex flex-wrap gap-2">
        {keys.map((key) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => onPick(SEARCH_SUGGESTIONS[key])}
              className="inline-flex min-h-11 items-center rounded-full border border-border bg-warm px-4 text-sm font-medium text-ink transition hover:border-brand hover:text-brand active:scale-95"
            >
              {t(`suggestions.${key}`)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The panel body for each search state; only `done` with matches shows the list. */
function SearchBody({
  state,
  query,
  onPick,
  onNavigate,
}: {
  state: SearchState;
  query: string;
  onPick: (query: string) => void;
  onNavigate: () => void;
}) {
  const t = useTranslations('search');

  switch (state.status) {
    case 'idle':
      return <Suggestions onPick={onPick} />;
    case 'loading':
      return <p className="p-8 text-center text-sm text-subtle">{t('loading')}</p>;
    case 'error':
      return (
        <p role="alert" className="p-8 text-center text-sm text-subtle">
          {t('error')}
        </p>
      );
    case 'done':
      return state.items.length > 0 ? (
        <SearchResults items={state.items} onNavigate={onNavigate} />
      ) : (
        <p className="p-8 text-center text-sm font-medium text-subtle">
          {t('noResults', { query: query.trim() })}
        </p>
      );
  }
}

/** Search input, a live result count for screen readers, and the state-dependent body. */
export function SearchPanel({ query, onQueryChange, onClose, inputRef }: SearchPanelProps) {
  const t = useTranslations('search');
  const state = useProductSearch(query);

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-center gap-3 border-b-2 border-border px-5 py-3 transition-colors focus-within:border-brand">
        <Search aria-hidden="true" size={20} className="shrink-0 text-subtle" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            // A search field's native Escape clears the text first; here Escape closes the
            // overlay in one press, as the dialog's other controls do.
            if (event.key === ESCAPE_KEY) {
              event.preventDefault();
              onClose();
            }
          }}
          aria-label={t('inputLabel')}
          placeholder={t('trigger')}
          className="min-h-11 min-w-0 flex-1 bg-transparent text-lg font-medium text-ink placeholder:text-subtle focus:outline-none [&::-webkit-search-cancel-button]:appearance-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-subtle underline-offset-4 transition-colors hover:text-ink hover:underline"
          >
            {t('clear')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-warm text-subtle transition hover:bg-border hover:text-ink active:scale-95"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>
      <p role="status" className="sr-only">
        {state.status === 'done' ? t('resultCount', { count: state.items.length }) : ''}
      </p>
      <SearchBody state={state} query={query} onPick={onQueryChange} onNavigate={onClose} />
    </div>
  );
}
