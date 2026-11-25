'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { ProductImage } from '../../lib/api/catalog';

/** Intrinsic size of the main image, for the browser to reserve the square. */
const MAIN_IMAGE_SIZE = 800;
const THUMB_SIZE = 80;

/** Primary image first, then the rest in the admin's order. */
const ordered = (images: ProductImage[]): ProductImage[] => [
  ...images.filter((image) => image.isPrimary),
  ...images.filter((image) => !image.isPrimary),
];

/**
 * Main image with a thumbnail strip to switch it. The main image is the page's largest paint,
 * so it loads eagerly at high priority. Without images it keeps the square as a plain tile.
 */
export function ProductGallery({ images, name }: { images: ProductImage[]; name: string }) {
  const t = useTranslations('pdp');
  const all = ordered(images);
  const [index, setIndex] = useState(0);
  const current = all[index];

  return (
    <div className="space-y-4">
      <div className="relative aspect-square overflow-hidden rounded-3xl bg-warm">
        {current ? (
          <img
            key={current.url}
            src={current.url}
            alt={current.altText?.trim() ? current.altText : name}
            width={MAIN_IMAGE_SIZE}
            height={MAIN_IMAGE_SIZE}
            fetchPriority="high"
            className="h-full w-full animate-img-swap object-cover"
          />
        ) : null}
      </div>
      {all.length > 1 ? (
        <ul className="flex gap-3 overflow-x-auto p-1">
          {all.map((image, i) => (
            <li key={image.url}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-pressed={i === index}
                aria-label={t('imageButton', { index: i + 1, total: all.length })}
                className="block h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 border-border transition hover:border-brand/50 active:scale-95 aria-pressed:border-brand"
              >
                <img
                  src={image.url}
                  alt=""
                  width={THUMB_SIZE}
                  height={THUMB_SIZE}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
