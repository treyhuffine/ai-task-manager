/**
 * Display helpers for app views. Dates come from the zone-aware time module.
 * Money is always integer minor units with an explicit ISO currency, never a
 * float, and different currencies are never added together.
 */
import { formatDate, formatDateRange, formatInstant, relativeDay, isLocalDate, localDate, systemZone, type LocalDate } from "../time.js";

export { formatDate, formatDateRange, formatInstant, relativeDay };

const digitCache = new Map<string, number>();
/** Minor-unit digits for an ISO currency: 2 for USD, 0 for JPY, 3 for KWD. */
export function currencyDigits(currency: string): number {
  const code = currency.toUpperCase();
  let digits = digitCache.get(code);
  if (digits === undefined) {
    try {
      digits = new Intl.NumberFormat("en-US", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    digitCache.set(code, digits);
  }
  return digits;
}

export function isCurrencyCode(value: string): boolean {
  if (!/^[A-Za-z]{3}$/.test(value)) return false;
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: value });
    return true;
  } catch {
    return false;
  }
}

/** The exact decimal string for minor units, such as "1234.50" for 123450 USD. */
export function minorToDecimal(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor)) throw new RangeError("Money amounts must be safe integers in minor units");
  const digits = currencyDigits(currency);
  const negative = minor < 0;
  const text = String(Math.abs(minor)).padStart(digits + 1, "0");
  const whole = digits ? text.slice(0, -digits) : text;
  const fraction = digits ? text.slice(-digits) : "";
  return `${negative ? "-" : ""}${whole}${fraction ? "." + fraction : ""}`;
}

/**
 * Format integer minor units in one currency, such as "$8,000.00" or, with
 * `display: "code"`, "8,000.00 USD". Formats the exact decimal string, so
 * large amounts never pass through floating point.
 */
export function formatMoney(
  minor: number,
  currency: string,
  options: { locale?: string; display?: "symbol" | "code"; trimZeroCents?: boolean } = {},
): string {
  const code = currency.toUpperCase();
  const decimal = minorToDecimal(minor, code) as `${number}`;
  const digits = currencyDigits(code);
  const whole = options.trimZeroCents && /\.0+$/.test(decimal);
  try {
    if (options.display === "code") {
      const number = new Intl.NumberFormat(options.locale ?? "en-US", {
        minimumFractionDigits: whole ? 0 : digits,
        maximumFractionDigits: digits,
      }).format(decimal);
      return `${number} ${code}`;
    }
    return new Intl.NumberFormat(options.locale ?? "en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: digits,
    }).format(decimal);
  } catch {
    return `${decimal} ${code}`;
  }
}

export type MoneyParse = { ok: true; minor: number | null } | { ok: false; error: string };
/**
 * Read typed money text into integer minor units for a currency. Accepts
 * digits with optional comma grouping and one decimal point, such as
 * "1,250.5" or "1250.50". Empty text is `minor: null`. Uses string arithmetic.
 */
export function parseMoneyInput(text: string, currency: string, options: { allowNegative?: boolean } = {}): MoneyParse {
  const trimmed = text.trim().replace(/\s+/g, "");
  if (!trimmed) return { ok: true, minor: null };
  const digits = currencyDigits(currency);
  const match = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/.exec(trimmed);
  if (!match || (match[2] === undefined && !match[3])) return { ok: false, error: digits ? "Enter an amount such as 1,250.00" : "Enter a whole amount such as 1,250" };
  if (match[1] && !options.allowNegative) return { ok: false, error: "Enter an amount of zero or more" };
  const whole = (match[2] ?? "0").replace(/,/g, "");
  const fraction = match[3] ?? "";
  if (fraction.length > digits)
    return { ok: false, error: digits ? `Use at most ${digits} decimal places for ${currency.toUpperCase()}` : `${currency.toUpperCase()} amounts have no decimal places` };
  const minorText = (whole + fraction.padEnd(digits, "0")).replace(/^0+(?=\d)/, "");
  const minor = Number(minorText);
  if (!Number.isSafeInteger(minor)) return { ok: false, error: "This amount is too large" };
  return { ok: true, minor: match[1] && minor !== 0 ? -minor : minor };
}

const plurals = new Map<string, Intl.PluralRules>();
/**
 * A counted phrase: `plural(1, "booking", "bookings")` is "1 booking" and
 * `plural(1200, "item", "items")` is "1,200 items".
 */
export function plural(count: number, one: string, many: string, locale = "en-US"): string {
  let rules = plurals.get(locale);
  if (!rules) plurals.set(locale, (rules = new Intl.PluralRules(locale)));
  return `${new Intl.NumberFormat(locale).format(count)} ${rules.select(count) === "one" ? one : many}`;
}

/**
 * A short label for a date or instant: "Oct 14" for a local date, or the
 * calendar date of an instant in the zone. Unparseable values return null.
 */
export function shortDateLabel(value: string, zone: string = systemZone()): string | null {
  try {
    const date: LocalDate = isLocalDate(value) ? value : localDate(value, zone);
    return formatDate(date, "short");
  } catch {
    return null;
  }
}

/** Initials for a neutral avatar: "Maya Chen" is "MC", "Prince" is "P". */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => /\p{L}|\p{N}/u.test(word));
  if (!words.length) return "?";
  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}
