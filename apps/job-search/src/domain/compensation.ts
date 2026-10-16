/**
 * Stated compensation, kept exactly as written: integer minor units, the
 * currency, the period and qualifiers such as base or total. Nothing here
 * converts an annual salary into an hourly rate or one currency into another.
 */
import { COMP_KIND_LABELS, COMP_PERIOD_LABELS } from './labels.js';
import type { Compensation } from './model.js';
import { stableHash } from './hash.js';

const SYMBOLS: [string, string][] = [['US$', 'USD'], ['CA$', 'CAD'], ['C$', 'CAD'], ['AU$', 'AUD'], ['A$', 'AUD'], ['NZ$', 'NZD'], ['S$', 'SGD'], ['$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY']];
const CODES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK', 'JPY', 'INR', 'NZD', 'SGD', 'MXN', 'BRL', 'PLN'];
const ZERO_DECIMAL = new Set(['JPY']);
const CUR = `(?:US\\$|CA\\$|C\\$|AU\\$|A\\$|NZ\\$|S\\$|\\$|€|£|¥|${CODES.join('|')})`;
const NUM = '\\d{1,3}(?:[,.\\u00a0\\u202f]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';
const AMOUNT = `(${CUR})?\\s?(${NUM})\\s?([kKmM])?(?![\\w])\\s?(${CUR})?`;
const RANGE = new RegExp(`${AMOUNT}(?:\\s*(?:-|–|—|to|and)\\s*${AMOUNT})?`, 'g');
const KEYWORDS = /salary|compensation|\bpay\b|\bbase\b|\brange\b|\brate\b|hourly|per hour|annual|\bOTE\b|on[- ]target|bonus|equity|stipend|\bwage|\/\s?(?:yr|year|hr|hour)\b|per (?:year|annum|month|week|day)|an? (?:year|hour)|\bTC\b|offer/i;

function currencyOf(token: string | undefined): string | null {
  if (!token) return null;
  const upper = token.toUpperCase();
  if (CODES.includes(upper)) return upper;
  return SYMBOLS.find(([symbol]) => symbol === token)?.[1] ?? null;
}

/** Parse "140,000", "1.5", "70.000" and "65.50" into exact minor units. */
export function toMinorUnits(raw: string, suffix: string | undefined, currency: string): number | null {
  const value = raw.replace(/[\s  ]/g, '');
  let integer = value, fraction = '';
  const last = Math.max(value.lastIndexOf(','), value.lastIndexOf('.'));
  if (last >= 0) {
    const tail = value.slice(last + 1);
    if (tail.length === 3) integer = value.replace(/[.,]/g, '');
    else if (tail.length <= 2) {
      integer = value.slice(0, last).replace(/[.,]/g, '');
      fraction = tail;
    } else return null;
  }
  if (!/^\d+$/.test(integer) || (fraction && !/^\d+$/.test(fraction))) return null;
  const exponent = ZERO_DECIMAL.has(currency) ? 0 : 2;
  const multiplier = suffix?.toLowerCase() === 'k' ? 1000 : suffix?.toLowerCase() === 'm' ? 1_000_000 : 1;
  // Work in hundredths of a major unit so "1.5k" stays exact.
  const hundredths = BigInt(integer) * 100n + BigInt((fraction + '00').slice(0, 2));
  const scaled = hundredths * BigInt(multiplier);
  const minor = exponent === 2 ? scaled : scaled / 100n;
  if (minor <= 0n || minor > 10_000_000_000_000n) return null;
  return Number(minor);
}

function periodNear(line: string, start: number, end: number): Compensation['period'] {
  const after = line.slice(end, end + 60).toLowerCase();
  const before = line.slice(Math.max(0, start - 50), start).toLowerCase();
  const test = (pattern: RegExp) => pattern.test(after) || pattern.test(before);
  if (test(/(?:\b(?:per|an?)\s+|\/\s?)(?:hour|hr)\b|\bhourly\b|\/h\b/)) return 'hour';
  if (test(/(?:\b(?:per|a)\s+|\/\s?)(?:year|yr|annum)\b|\bannual(?:ly)?\b|\bp\.?a\.?\b|\byearly\b/)) return 'year';
  if (test(/(?:\b(?:per|a)\s+|\/\s?)(?:month|mo)\b|\bmonthly\b/)) return 'month';
  if (test(/(?:\b(?:per|a)\s+|\/\s?)(?:week|wk)\b|\bweekly\b/)) return 'week';
  if (test(/(?:\b(?:per|a)\s+|\/\s?)day\b|\bdaily\b/)) return 'day';
  if (test(/\b(sign[- ]?on|signing|one[- ]time|relocation)\b/)) return 'one_time';
  return 'unstated';
}

function kindOf(line: string, period: Compensation['period']): Compensation['kind'] {
  const text = line.toLowerCase();
  if (/total (compensation|comp|cash|target)|\bote\b|on[- ]target|\btc\b/.test(text)) return 'total';
  if (period === 'hour') return 'hourly';
  if (/\b(sign[- ]?on|signing|annual|performance|target)? ?bonus\b/.test(text) && !/salary|base/.test(text)) return 'bonus';
  if (/\b(equity|rsus?|stock|options)\b/.test(text) && !/salary|base/.test(text)) return 'equity';
  if (/\bbase\b|salary/.test(text)) return 'base';
  return 'other';
}

function qualifiersOf(line: string, kind: Compensation['kind']): string[] {
  const text = line.toLowerCase();
  const found: string[] = [];
  if (/\bbase\b/.test(text) && kind !== 'base') found.push('base');
  if (kind === 'base') found.push('base salary');
  if (/\bote\b|on[- ]target/.test(text)) found.push('on-target earnings');
  if (/(equity|rsus?|stock options)/.test(text) && kind !== 'equity') found.push('plus equity');
  if (/bonus/.test(text) && kind !== 'bonus') found.push('plus bonus');
  const depends = /depend\w* (?:on|upon) (?:your )?(experience|location|level|skills)/.exec(text);
  if (depends) found.push(`depends on ${depends[1]}`);
  if (/location[- ]based|geographic|by location|varies by (?:location|region)/.test(text)) found.push('varies by location');
  if (/\b(pre[- ]tax|before tax|gross)\b/.test(text)) found.push('before tax');
  return [...new Set(found)].slice(0, 8);
}

/**
 * Compensation stated in text, one entry per amount or range, each with its
 * exact passage. Only lines that talk about pay are read, so funding rounds
 * and prices are not mistaken for salaries.
 */
export function parseCompensation(text: string, source: Compensation['source']): Compensation[] {
  const results: Compensation[] = [];
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line || line.length > 1200 || !KEYWORDS.test(line)) continue;
    for (const match of line.matchAll(RANGE)) {
      const [whole, cur1, num1, suf1, cur1b, cur2, num2, suf2, cur2b] = match;
      const currency = currencyOf(cur1) ?? currencyOf(cur1b) ?? currencyOf(cur2) ?? currencyOf(cur2b);
      if (!currency) continue;
      let first = toMinorUnits(num1, suf1 ?? (num2 && suf2 && !suf1 ? suf2 : undefined), currency);
      const second = num2 ? toMinorUnits(num2, suf2, currency) : null;
      if (first === null) continue;
      // "$140-165K": the shared suffix applies to both ends only when that keeps the range ordered.
      if (second !== null && !suf1 && suf2 && first > second) first = toMinorUnits(num1, undefined, currency);
      if (first === null) continue;
      const start = match.index ?? 0;
      const period = periodNear(line, start, start + whole.length);
      const kind = kindOf(line, period);
      const [minMinor, maxMinor] = second !== null && second < first ? [second, first] : [first, second ?? first];
      results.push({
        id: stableHash(`${line}|${start}`).slice(0, 16),
        kind,
        minMinor,
        maxMinor,
        currency,
        period,
        qualifiers: qualifiersOf(line, kind),
        source,
        passage: line.slice(0, 400),
      });
      if (results.length >= 8) return results;
    }
  }
  return results;
}

/** "$140,000 to $165,000 a year" with exact amounts and the stated period. */
export function formatCompensation(item: Pick<Compensation, 'minMinor' | 'maxMinor' | 'currency' | 'period' | 'kind' | 'qualifiers'>, locale = 'en-US'): string {
  const money = (minor: number) => {
    const exponent = ZERO_DECIMAL.has(item.currency) ? 0 : 2;
    const major = minor / 10 ** exponent;
    const whole = Number.isInteger(major);
    return new Intl.NumberFormat(locale, { style: 'currency', currency: item.currency, minimumFractionDigits: whole ? 0 : exponent, maximumFractionDigits: exponent }).format(major);
  };
  const amount = item.minMinor === null && item.maxMinor === null
    ? 'Amount not stated'
    : item.minMinor !== null && item.maxMinor !== null && item.minMinor !== item.maxMinor
      ? `${money(item.minMinor)} to ${money(item.maxMinor)}`
      : money((item.minMinor ?? item.maxMinor)!);
  const period = item.period === 'unstated' ? ` (${COMP_PERIOD_LABELS.unstated})` : item.period === 'one_time' ? ' one time' : ` ${COMP_PERIOD_LABELS[item.period]}`;
  return `${amount}${period}`;
}
export function compensationLabel(item: Pick<Compensation, 'kind'>): string {
  return COMP_KIND_LABELS[item.kind];
}

/**
 * Whether two stated amounts can be compared as written. Different
 * currencies, periods or kinds (base against total) are never converted.
 */
export function compareCompensation(a: Compensation, b: Compensation): { comparable: boolean; reason: string } {
  if (a.currency !== b.currency) return { comparable: false, reason: `Stated in ${a.currency} and ${b.currency}. Amounts are not converted.` };
  if (a.period === 'unstated' || b.period === 'unstated') return { comparable: false, reason: 'One amount has no stated period, so it is not compared.' };
  if (a.period !== b.period) return { comparable: false, reason: `Stated ${COMP_PERIOD_LABELS[a.period]} and ${COMP_PERIOD_LABELS[b.period]}. Comparing them would need an explicit assumption about hours or months worked.` };
  const family = (kind: Compensation['kind']) => (kind === 'hourly' ? 'base' : kind);
  if (family(a.kind) !== family(b.kind)) return { comparable: false, reason: `${COMP_KIND_LABELS[a.kind]} and ${COMP_KIND_LABELS[b.kind].toLowerCase()} measure different things.` };
  return { comparable: true, reason: 'Same currency, period and kind.' };
}
