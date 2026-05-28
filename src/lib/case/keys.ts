/**
 * Recursive key-case conversion at the JSON boundary.
 *
 * Bridges camelCase app code with snake_case JSON column contents. Drizzle's
 * `casing: 'snake_case'` handles column *keys* — this module handles the
 * *contents* of JSON columns (e.g. `Attachment[]`), which Drizzle treats as
 * opaque blobs.
 *
 * Round-trip is lossless for any JSON value: primitives, arrays, plain
 * objects, null/undefined. Non-plain objects (Date, RegExp, Map, Set, class
 * instances) pass through untouched — we only recurse into plain objects
 * and arrays since JSON columns can only hold those.
 */

// ── String case conversion (types) ─────────────────────────

export type SnakeToCamel<S extends string> =
  S extends `${infer Head}_${infer Tail}`
    ? `${Head}${Capitalize<SnakeToCamel<Tail>>}`
    : S;

export type CamelToSnake<S extends string> =
  S extends `${infer Head}${infer Tail}`
    ? Head extends Lowercase<Head>
      ? `${Head}${CamelToSnake<Tail>}`
      : `_${Lowercase<Head>}${CamelToSnake<Tail>}`
    : S;

// ── String case conversion (runtime) ───────────────────────

export function snakeToCamel<S extends string>(s: S): SnakeToCamel<S> {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()) as SnakeToCamel<S>;
}

export function camelToSnake<S extends string>(s: S): CamelToSnake<S> {
  return s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()) as CamelToSnake<S>;
}

// ── Object/array key conversion (types) ────────────────────

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type Opaque = Date | RegExp | Map<unknown, unknown> | Set<unknown>;

export type CamelizeKeys<T> =
  T extends Primitive ? T
  : T extends Opaque ? T
  : T extends ReadonlyArray<infer U> ? CamelizeKeys<U>[]
  : T extends object ? { [K in keyof T as K extends string ? SnakeToCamel<K> : K]: CamelizeKeys<T[K]> }
  : T;

export type SnakeizeKeys<T> =
  T extends Primitive ? T
  : T extends Opaque ? T
  : T extends ReadonlyArray<infer U> ? SnakeizeKeys<U>[]
  : T extends object ? { [K in keyof T as K extends string ? CamelToSnake<K> : K]: SnakeizeKeys<T[K]> }
  : T;

// ── Object/array key conversion (runtime) ──────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function camelizeKeys<T>(value: T): CamelizeKeys<T> {
  if (Array.isArray(value)) {
    return value.map((item) => camelizeKeys(item)) as CamelizeKeys<T>;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[snakeToCamel(k)] = camelizeKeys(v);
    }
    return out as CamelizeKeys<T>;
  }
  return value as CamelizeKeys<T>;
}

export function snakeizeKeys<T>(value: T): SnakeizeKeys<T> {
  if (Array.isArray(value)) {
    return value.map((item) => snakeizeKeys(item)) as SnakeizeKeys<T>;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[camelToSnake(k)] = snakeizeKeys(v);
    }
    return out as SnakeizeKeys<T>;
  }
  return value as SnakeizeKeys<T>;
}
