/**
 * `JSON.stringify` throws on BigInt, and Prisma returns every poysha column as
 * one. Mappers convert prices to numbers explicitly, so this is a safety net
 * that turns a missed conversion into a string in the payload rather than a
 * 500 — install it once, in main.ts, before the app starts.
 */
export const installBigIntJsonSerializer = (): void => {
  const bigIntPrototype = BigInt.prototype as unknown as { toJSON?: () => string };
  bigIntPrototype.toJSON = function toJSON(this: bigint): string {
    return this.toString();
  };
};
