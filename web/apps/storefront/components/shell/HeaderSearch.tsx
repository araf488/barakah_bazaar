'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { SearchPanel } from './SearchPanel';

/** The key that opens search from anywhere on the page, as in the Figma file. */
export const SEARCH_HOTKEY = '/';

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True while the visitor is typing somewhere, when "/" must stay a character. */
const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || EDITABLE_TAGS.has(target.tagName));

/**
 * The header's search pill (and its icon twin on phones) plus the overlay they open. The overlay
 * is a native modal <dialog>: the browser traps focus, makes the page behind it inert, closes it
 * on Escape and returns focus to the trigger.
 */
export function HeaderSearch() {
  const t = useTranslations('search');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  const open = useCallback(() => {
    setQuery('');
    dialogRef.current?.showModal();
    inputRef.current?.focus();
  }, []);

  const close = useCallback(() => dialogRef.current?.close(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== SEARCH_HOTKEY || isEditable(event.target) || dialogRef.current?.open) {
        return;
      }
      event.preventDefault();
      open();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-keyshortcuts={SEARCH_HOTKEY}
        className="group hidden min-h-11 max-w-lg flex-1 items-center gap-3 rounded-full border border-border bg-warm px-5 text-sm text-ink/70 transition duration-200 hover:border-brand/50 hover:bg-white active:scale-[0.99] sm:flex"
      >
        <Search aria-hidden="true" size={16} className="transition-colors group-hover:text-brand" />
        <span className="flex-1 text-left">{t('trigger')}</span>
        <kbd
          aria-hidden="true"
          className="rounded bg-border px-1.5 py-0.5 font-mono text-[11px] text-ink/70"
        >
          {SEARCH_HOTKEY}
        </kbd>
      </button>
      <button
        type="button"
        onClick={open}
        aria-label={t('open')}
        className="flex h-11 w-11 items-center justify-center rounded-full text-subtle transition hover:bg-warm hover:text-brand active:scale-95 sm:hidden"
      >
        <Search aria-hidden="true" size={20} />
      </button>
      <dialog
        ref={dialogRef}
        aria-label={t('dialogLabel')}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            close();
          }
        }}
        className="mx-auto mt-20 w-[calc(100%-2rem)] max-w-2xl bg-transparent p-0 backdrop:bg-ink/60 backdrop:backdrop-blur-md open:animate-slide-down"
      >
        <SearchPanel query={query} onQueryChange={setQuery} onClose={close} inputRef={inputRef} />
      </dialog>
    </>
  );
}
