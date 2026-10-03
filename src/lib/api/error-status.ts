/** Transport errors may happen before the tRPC envelope exists (a proxy,
 * pairing expiry, or protocol mismatch). Preserve those HTTP semantics too. */
export function apiErrorStatus(error: unknown): number | undefined {
  let current = error;
  for (let depth = 0; current && depth < 4; depth++) {
    const e = current as { status?: unknown; data?: { httpStatus?: unknown }; meta?: { response?: { status?: unknown } }; cause?: unknown };
    const status = e.status ?? e.data?.httpStatus ?? e.meta?.response?.status;
    if (typeof status === 'number') return status;
    current = e.cause;
  }
}
