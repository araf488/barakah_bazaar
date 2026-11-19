'use client';

import type { ReactNode } from 'react';

import { openSearch } from '../lib/searchEvents';

interface SearchButtonProps {
  /** Starts the overlay with this text already searched. */
  query?: string;
  className: string;
  children: ReactNode;
}

/** A call to action that opens the header's search overlay, so it never needs its own page. */
export function SearchButton({ query, className, children }: SearchButtonProps) {
  return (
    <button type="button" onClick={() => openSearch(query)} className={className}>
      {children}
    </button>
  );
}
