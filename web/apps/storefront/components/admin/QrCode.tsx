import { encode } from 'uqr';

/** Light modules around the code, as the QR specification asks, so scanners find its edges. */
const QUIET_ZONE = 4;

/** One SVG path drawing every dark module: no image, no request, nothing leaves the page. */
export const qrPath = (data: readonly (readonly boolean[])[]): string =>
  data
    .flatMap((row, y) =>
      row.map((dark, x) => (dark ? `M${x + QUIET_ZONE},${y + QUIET_ZONE}h1v1h-1z` : '')),
    )
    .join('');

/**
 * A QR code drawn in the browser from `value`. For the authenticator key that matters: the key
 * is a second factor, and handing it to an image service would hand that factor over.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { data } = encode(value);
  const extent = data.length + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${extent} ${extent}`}
      shapeRendering="crispEdges"
      className="size-48 rounded-xl bg-white"
    >
      <path d={qrPath(data)} fill="currentColor" className="text-ink" />
    </svg>
  );
}
