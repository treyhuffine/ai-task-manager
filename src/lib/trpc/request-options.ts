import type { RequestOptions } from '@/lib/api/client';

/** Preserve the old query parsers during domain extraction. The procedure
 * schema owns the allowed keys. New procedures can use native input values. */
export function rpcQuery<T extends NonNullable<RequestOptions['query']>>(values: T | undefined): { [K in keyof T]?: string } {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value != null) result[key] = Array.isArray(value) ? value.join(',') : String(value);
  }
  return result as { [K in keyof T]?: string };
}
export function rpcOptions(options: Pick<RequestOptions, 'signal' | 'timeoutMs' | 'headers'> = {}) {
  const timeout = options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined;
  const signal = options.signal && timeout ? AbortSignal.any([options.signal, timeout]) : options.signal ?? timeout;
  return { signal, ...(options.headers ? { context: { headers: options.headers } } : {}) };
}
