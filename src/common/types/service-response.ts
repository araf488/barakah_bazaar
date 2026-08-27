import { HttpException } from '@nestjs/common';

/**
 * The failure shape every service returns instead of throwing.
 *
 * Services and repositories catch their own exceptions (see the layering rules
 * in the README) and hand the caller a value it can branch on. Controllers are
 * the HTTP boundary and are the only place a `ServiceResponse` becomes an
 * exception, via `unwrapOrThrow`.
 */
export type ServiceResponse<TData> =
  | { readonly ok: true; readonly data: TData }
  | { readonly ok: false; readonly status: number; readonly message: string };

export const serviceOk = <TData>(data: TData): ServiceResponse<TData> => ({ ok: true, data });

export const serviceFail = <TData = never>(
  status: number,
  message: string,
): ServiceResponse<TData> => ({ ok: false, status, message });

/** Unwraps a successful response, or throws the HTTP error it describes. */
export const unwrapOrThrow = <TData>(response: ServiceResponse<TData>): TData => {
  if (response.ok) {
    return response.data;
  }
  throw new HttpException(response.message, response.status);
};
