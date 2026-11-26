// Names a signed-in device from its user agent: "Chrome on Android". Browser and system names
// are product names, so they are not translated. Order matters in both tables: Edge, Opera and
// Samsung Internet also say "Chrome", and every iOS browser also says "Safari".

export interface DeviceName {
  browser: string | null;
  system: string | null;
}

type Signature = readonly [pattern: RegExp, name: string];

const BROWSERS: readonly Signature[] = [
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\b(OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(Firefox|FxiOS)\//, 'Firefox'],
  [/\b(Chrome|CriOS)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: readonly Signature[] = [
  [/\bAndroid\b/, 'Android'],
  [/\biPad\b/, 'iPadOS'],
  [/\b(iPhone|iPod)\b/, 'iOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

const firstMatch = (table: readonly Signature[], userAgent: string): string | null =>
  table.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;

/** The browser and system a user agent names; either is `null` when it names none we know. */
export const deviceNameOf = (userAgent: string | null): DeviceName =>
  userAgent
    ? { browser: firstMatch(BROWSERS, userAgent), system: firstMatch(SYSTEMS, userAgent) }
    : { browser: null, system: null };
