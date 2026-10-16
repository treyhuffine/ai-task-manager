/** Small row and value helpers for the SQLite query layer. */
import { AppError } from '@ri/app-kit/contract';
import { allows, type AccessScope } from '@ri/app-kit/data';

export type Row = Record<string, unknown>;

export const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
export const opt = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
export const num = (value: unknown): number => Number(value ?? 0);
export const bool = (value: unknown): boolean => Number(value) === 1;
export function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}
/** Escape a LIKE pattern so user text matches literally. */
export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
/** `?, ?, ?` for an IN list. */
export const marks = (count: number) => Array.from({ length: count }, () => '?').join(', ');

export function notFound(what: string): never {
  throw new AppError('not_found', `${what} is not available. It may have been removed, or this chat was not given access to it`);
}

/** Throw unless the scope may see this collection or account. */
export function requireSource(scope: AccessScope, source: string, what = 'these records') {
  if (!allows(scope, source)) throw new AppError('forbidden', `This caller was not given access to ${what}`);
}

/** Group rows by a key. */
export function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    const list = map.get(value);
    if (list) list.push(row);
    else map.set(value, [row]);
  }
  return map;
}

export function clampText(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}
