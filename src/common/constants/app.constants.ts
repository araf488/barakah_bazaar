/**
 * Application-wide constants. Domain-specific values belong in the owning
 * module's own `<module>.constants.ts`, not here.
 */
export const ApplicationConstants = {
  /** Human-readable service name, used in logs, Swagger and health output. */
  ServiceName: 'Barakah Bazaar API',
  /** Shown on the Swagger landing page. */
  ServiceDescription:
    'Halal-first multi-category commerce API serving the web storefront, admin portal and mobile app.',
  /** Route segment Swagger is mounted on, relative to the API prefix. */
  SwaggerPath: 'docs',
  /** Correlation id echoed on every response and attached to every log line. */
  RequestIdHeader: 'x-request-id',
  /** Bearer scheme prefix expected on the Authorization header. */
  BearerPrefix: 'Bearer ',
  /** Locale used for currency and number formatting in API-generated text. */
  DefaultLocale: 'en-BD',
  /** ISO 4217 code for Bangladeshi Taka. */
  CurrencyCode: 'BDT',
} as const;

/** Reflector metadata keys. Kept together so no decorator invents its own. */
export const MetadataKeys = {
  IsPublic: 'barakah:is-public',
  Roles: 'barakah:roles',
} as const;

/** Paging defaults for every list endpoint. */
export const PaginationDefaults = {
  Page: 1,
  Limit: 20,
  MaxLimit: 100,
} as const;

/**
 * Prisma error codes this application classifies rather than treats as faults.
 *
 * A code here means the database reported something a caller can act on, so the repository
 * returns it as data at a log level below `error` — reserving `error` (and its stack trace)
 * for the faults that actually need looking at.
 */
export const PrismaErrorCodes = {
  /**
   * An `update` or `delete` matched no row. On a conditional write that means the condition
   * did not hold, not that anything is broken.
   */
  RecordNotFound: 'P2025',
} as const;

/** Shutdown grace period, in milliseconds, for in-flight requests. */
export const ShutdownGracePeriodMs = 10_000;
