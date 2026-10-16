/**
 * Low-level readers for confirmation text: calendar dates in common English,
 * Portuguese, Spanish, French and German forms, clock times, labeled lines,
 * references and traveler names. Every reader returns the exact substring it
 * used so extracted fields can cite their source passage.
 */
import { addDays, daysBetween, isLocalDate } from "@ri/app-kit/time";

const MONTH_WORDS: Record<string, number> = {
  january: 1, jan: 1, janeiro: 1, enero: 1, ene: 1, janvier: 1, janv: 1, januar: 1,
  february: 2, feb: 2, fev: 2, fevereiro: 2, febrero: 2, "février": 2, fevrier: 2, "févr": 2, fevr: 2, februar: 2,
  march: 3, mar: 3, "março": 3, marco: 3, marzo: 3, mars: 3, "märz": 3, marz: 3,
  april: 4, apr: 4, abril: 4, abr: 4, avril: 4, avr: 4,
  may: 5, maio: 5, mayo: 5, mai: 5,
  june: 6, jun: 6, junho: 6, junio: 6, juin: 6, juni: 6,
  july: 7, jul: 7, julho: 7, julio: 7, juillet: 7, juil: 7, juli: 7,
  august: 8, aug: 8, agosto: 8, "août": 8, aout: 8,
  september: 9, sep: 9, sept: 9, setembro: 9, septiembre: 9, septembre: 9,
  october: 10, oct: 10, outubro: 10, octubre: 10, octobre: 10, oktober: 10, okt: 10,
  november: 11, nov: 11, novembro: 11, noviembre: 11, novembre: 11,
  december: 12, dec: 12, dezembro: 12, dez: 12, diciembre: 12, dic: 12, "décembre": 12, decembre: 12, "déc": 12, dezember: 12,
};
const MONTH_ALT = Object.keys(MONTH_WORDS).sort((a, b) => b.length - a.length).join("|");
const WEEKDAY = "(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday|rsday)?|seg|ter|qua|qui|sex|sab|dom|lun|mar|mie|jue|vie|mardi|lundi|mercredi|jeudi|vendredi|samedi|dimanche)\\.?,?\\s+";
const MONTH_FIRST = new RegExp(`(?<![\\p{L}\\d])(?:${WEEKDAY})?(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\s*[:h]\\d)(?![\\p{L}\\d])(?:,?\\s+(\\d{4}))?`, "giu");
const DAY_FIRST = new RegExp(`(?<![\\p{L}\\d])(?:${WEEKDAY})?(\\d{1,2})(?:st|nd|rd|th|\\.|º)?\\s+(?:de\\s+|of\\s+)?(${MONTH_ALT})\\.?(?![\\p{L}])(?:,?\\s+(?:de\\s+)?(\\d{4}))?`, "giu");
const ISO_DATE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const SLASH_DATE = /(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?![\d/])/g;
const DOT_DATE = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})(?![\d.])/g;

export interface FoundDate {
  date: string;
  index: number;
  raw: string;
  inferredYear: boolean;
  /** Set when the text could mean another date, such as 03/12/2026. */
  ambiguity: string | null;
}

const pad = (value: number) => String(value).padStart(2, "0");
function build(year: number, month: number, day: number): string | null {
  const value = `${year}-${pad(month)}-${pad(day)}`;
  return isLocalDate(value) ? value : null;
}
/** Year for a date written without one: the next occurrence on or after a month before the reference date. */
export function inferYear(month: number, day: number, reference: string): string | null {
  const refYear = Number(reference.slice(0, 4));
  for (const year of [refYear, refYear + 1]) {
    const candidate = build(year, month, day);
    if (candidate && daysBetween(addDays(reference, -45), candidate) >= 0) return candidate;
  }
  return build(refYear + 1, month, day);
}

/** Every calendar date in the text, in reading order. `reference` (YYYY-MM-DD) completes dates without a year. */
export function findDates(text: string, reference: string): FoundDate[] {
  const found: FoundDate[] = [];
  const taken: [number, number][] = [];
  const free = (start: number, end: number) => taken.every(([a, b]) => end <= a || start >= b);
  const add = (item: FoundDate) => {
    if (!free(item.index, item.index + item.raw.length)) return;
    taken.push([item.index, item.index + item.raw.length]);
    found.push(item);
  };
  for (const match of text.matchAll(ISO_DATE)) {
    const date = build(+match[1], +match[2], +match[3]);
    if (date) add({ date, index: match.index!, raw: match[0], inferredYear: false, ambiguity: null });
  }
  for (const [pattern, monthGroup, dayGroup] of [[MONTH_FIRST, 1, 2], [DAY_FIRST, 2, 1]] as const) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const month = MONTH_WORDS[match[monthGroup].toLowerCase()];
      const day = Number(match[dayGroup]);
      if (!month || day < 1 || day > 31) continue;
      const year = match[3] ? Number(match[3]) : null;
      const date = year ? build(year, month, day) : inferYear(month, day, reference);
      if (date) add({ date, index: match.index!, raw: match[0].trim(), inferredYear: !year, ambiguity: null });
    }
  }
  for (const match of text.matchAll(DOT_DATE)) {
    const date = build(+match[3], +match[2], +match[1]);
    if (date) add({ date, index: match.index!, raw: match[0], inferredYear: false, ambiguity: null });
  }
  for (const match of text.matchAll(SLASH_DATE)) {
    const a = +match[1], b = +match[2];
    let year = +match[3];
    if (year < 100) year += 2000;
    if (a > 12 && b <= 12) {
      const date = build(year, b, a);
      if (date) add({ date, index: match.index!, raw: match[0], inferredYear: false, ambiguity: null });
    } else if (b > 12 && a <= 12) {
      const date = build(year, a, b);
      if (date) add({ date, index: match.index!, raw: match[0], inferredYear: false, ambiguity: null });
    } else if (a <= 12 && b <= 12) {
      const us = build(year, a, b), other = build(year, b, a);
      if (us) add({ date: us, index: match.index!, raw: match[0], inferredYear: false, ambiguity: a === b || !other ? null : `${match[0]} could be ${monthName(a)} ${b} or ${monthName(b)} ${a}` });
    }
  }
  return found.sort((x, y) => x.index - y.index);
}
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthName(month: number) {
  return MONTH_NAMES[month - 1] ?? String(month);
}

export interface FoundTime { time: string; index: number; raw: string }
const CLOCK = /(?<![\d:.])([01]?\d|2[0-3])(?::|h)([0-5]\d)(?![\d:])\s*(a\.?\s?m\.?|p\.?\s?m\.?)?(?![\p{L}])/giu;
const HOUR_ONLY = /(?<![\d:.])(1[0-2]|0?[1-9])\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![\p{L}])/giu;
const NOON = /\b(noon|midday)\b/gi;
function to24(hour: number, minute: number, meridiem: string | undefined): string | null {
  let h = hour;
  if (meridiem) {
    const pm = /^p/i.test(meridiem);
    if (h < 1 || h > 12) return null;
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  if (h > 23 || minute > 59) return null;
  return `${pad(h)}:${pad(minute)}`;
}
/** Every clock time in the text, normalized to 24-hour `HH:MM`. */
export function findTimes(text: string): FoundTime[] {
  const found: FoundTime[] = [];
  for (const match of text.matchAll(CLOCK)) {
    const time = to24(+match[1], +match[2], match[3]);
    if (time) found.push({ time, index: match.index!, raw: match[0].trim() });
  }
  for (const match of text.matchAll(HOUR_ONLY)) {
    if (found.some((item) => match.index! >= item.index && match.index! < item.index + item.raw.length)) continue;
    const time = to24(+match[1], 0, match[2]);
    if (time) found.push({ time, index: match.index!, raw: match[0].trim() });
  }
  for (const match of text.matchAll(NOON)) found.push({ time: "12:00", index: match.index!, raw: match[0] });
  return found.sort((a, b) => a.index - b.index);
}

/** Lines with their offsets in the original text, so a passage is always an exact substring. */
export interface Line { text: string; index: number }
export function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let offset = 0;
  for (const raw of text.split("\n")) {
    const lead = raw.length - raw.trimStart().length;
    const value = raw.trim();
    if (value) lines.push({ text: value, index: offset + lead });
    offset += raw.length + 1;
  }
  return lines;
}

export interface Labeled {
  /** The text after the label on its line, plus the following lines when the label stands alone. */
  value: string;
  /** Exact lines used. */
  passages: string[];
  line: number;
}
/**
 * Find the first line starting with a label. When the line holds only the
 * label (as an HTML table often renders), the next `follow` lines are the value.
 */
export function labeled(lines: Line[], label: RegExp, options: { from?: number; to?: number; follow?: number } = {}): Labeled | null {
  const end = Math.min(options.to ?? lines.length, lines.length);
  for (let index = options.from ?? 0; index < end; index++) {
    const match = label.exec(lines[index].text);
    if (!match || match.index !== 0) continue;
    const rest = lines[index].text.slice(match[0].length).replace(/^[\s:|#\-–]+/, "").trim();
    const passages = [lines[index].text];
    let value = rest;
    const follow = options.follow ?? 2;
    if (rest.length < 3 || !/[\p{L}\d]{2}/u.test(rest)) {
      const parts: string[] = rest ? [rest] : [];
      for (let next = index + 1; next < Math.min(end, index + 1 + follow); next++) {
        if (LABEL_START.test(lines[next].text)) break;
        parts.push(lines[next].text);
        passages.push(lines[next].text);
      }
      value = parts.join(" ").trim();
    }
    return { value, passages, line: index };
  }
  return null;
}
/** Lines that begin a new labeled field, used to stop a multi-line value. */
export const LABEL_START = /^(check[\s-]?in|check[\s-]?out|depart(?:ure|s|ing)?|arriv(?:al|es|e|ing)|from|to|pick[\s-]?up|drop[\s-]?off|return(?:\s+(?:date|time|location))?|passengers?|travell?ers?|guests?|driver|confirmation|booking|reservation|address|flight|train|date|time|total|price|room|status)\b[^\p{L}]*/iu;

const REFERENCE_LABEL = /(?<![A-Za-z])(?:confirmation|booking|reservation|record\s+locator|pnr|itinerary|order)(?:\s+(?:number|no\.?|code|reference|ref\.?|id|#))?\s*(?:is)?\s*[:#]?\s*([A-Z0-9](?:[A-Z0-9-]{2,18}[A-Z0-9]))(?![A-Za-z0-9-])/gi;
const STOP_REFERENCES = new Set(["CONFIRMED", "CONFIRMATION", "DETAILS", "NUMBER", "BOOKING", "RESERVATION", "UPDATED", "CHANGED", "CANCELED", "CANCELLED", "ITINERARY", "RECEIPT", "SUMMARY", "REFERENCE", "PENDING", "REQUEST", "MANAGE", "STATUS", "CHECK"]);
/** Booking references with the exact passage, in reading order. A reference needs a digit or six capital letters. */
export function findReferences(text: string): { value: string; index: number; raw: string }[] {
  const found: { value: string; index: number; raw: string }[] = [];
  for (const match of text.matchAll(REFERENCE_LABEL)) {
    const value = match[1];
    const upper = value.toUpperCase();
    if (STOP_REFERENCES.has(upper)) continue;
    const pnr = /^[A-Z]{6}$/.test(value);
    if (!/\d/.test(value) && !pnr) continue;
    if (/^\d{1,3}$/.test(value)) continue;
    found.push({ value, index: match.index!, raw: match[0] });
  }
  return found;
}
export function normalizeReference(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return key.length >= 3 ? key : null;
}

const TITLES = /^(mr|mrs|ms|mx|dr|miss|mstr|master|sir|madam|prof)\.?$/i;
/** Words that show a value is a description rather than a person. */
const NOT_NAME = /^(you|your|guest|guests|traveler|traveller|travelers|passenger|passengers|none|table|party|for|of|one|two|three|room|seat|ticket|tickets|adult|adults|child|children|night|nights|booking|reservation|confirmation|confirmed|details|the|and|with|economy|business|class|included|not)$/i;
/** "RIVERA/ALEX MR" becomes "Alex Rivera". Titles and roles are removed. Returns null for text that is not a name. */
export function cleanName(raw: string): string | null {
  let value = raw.replace(/\((?:adult|child|infant|lead|primary)[^)]*\)/gi, " ").replace(/\b(?:adult|child|infant)\s*\d*\b/gi, " ").trim();
  value = value.replace(/^[-•*\d.)\s]+/, "").replace(/[;,.]+$/, "").trim();
  if (!value || /\d/.test(value) || value.length > 80) return null;
  const slash = /^([\p{L}' -]+)\/([\p{L}' -]+)$/u.exec(value);
  if (slash) value = `${slash[2]} ${slash[1]}`;
  const words = value.split(/\s+/).filter((word) => !TITLES.test(word));
  if (!words.length || words.length > 6 || words.some((word) => !/^[\p{L}][\p{L}'.-]*$/u.test(word))) return null;
  const cased = words.map((word) => (word === word.toUpperCase() || word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word));
  const name = cased.join(" ");
  if (cased.some((word) => NOT_NAME.test(word))) return null;
  return name;
}
/** Split a traveler list such as "Alex Rivera, Sam Okafor and Jo Lee". */
export function splitNames(value: string): string[] {
  const names = value
    .split(/\s*(?:,|;|\band\b|&|\||\n|\s{2,})\s*/i)
    .map(cleanName)
    .filter((name): name is string => !!name);
  return [...new Set(names)].slice(0, 20);
}
/** Lower-case tokens without titles, sorted, for comparing names written differently. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[\s/.,'-]+/)
    .filter((token) => token && !TITLES.test(token))
    .sort()
    .join(" ");
}
