/**
 * Deterministic extraction of bookings from confirmation text: email bodies,
 * HTML converted to text, PDF text and pasted confirmations. Each reader
 * looks for the labeled shapes providers commonly use and returns exact
 * passages for what it found. Anything it cannot read is listed as missing
 * instead of guessed, so a partial result goes to Review rather than becoming
 * a fabricated booking.
 */
import { addDays } from "@ri/app-kit/time";
import type { BookingDraft, BookingKind, ParseResult, ParsedBooking, SegmentDraft, StayDraft } from "../model.js";
import { resolveEndpoint } from "../clock.js";
import { airport, airportCity, findCityZone, isKnownAirport } from "../places.js";
import { cleanName, findDates, findReferences, findTimes, labeled, splitLines, splitNames, type FoundDate, type Line } from "./text.js";

/** Bump when extraction rules change, so stored sources can be re-read. */
export const PARSE_VERSION = 1;

export interface ParseInvite {
  method: string | null;
  uid: string | null;
  summary: string | null;
  start: string | null;
  end: string | null;
  status: string | null;
  sequence: number | null;
}
export interface ParseInput {
  /** The canonical source text. Passages are exact substrings of it. */
  text: string;
  subject?: string | null;
  senderName?: string | null;
  senderAddress?: string | null;
  /** Reference instant for dates written without a year. */
  receivedAt?: string | null;
  invite?: ParseInvite | null;
}

export const FORWARD_MARKER = /^(?:-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:|-{2,}\s*Original Message\s*-{2,})/im;
const FORWARD_SUBJECT = /^\s*(?:fwd?|fw)\s*:/i;
const CANCEL = /(?:\b(?:has|have)\s+been\s+cancell?ed\b|\b(?:was|were|is|are)\s+(?:now\s+)?cancell?ed\b|\bwe(?:'|’)?ve\s+cancell?ed\b|\bwe\s+have\s+cancell?ed\b|\bcancell?ation\s+(?:confirm(?:ation|ed)?|notice|complete|number|reference)\b|\b(?:booking|reservation|flight|stay|trip|order|ticket)\s+(?:is\s+)?cancell?ed\b|^\s*(?:subject:\s*)?cancell?ed\b|\bcancell?ation\s+of\s+(?:your\s+)?(?:booking|reservation|flight|stay))/im;
const CHANGE = /\b(?:schedule\s+change|has\s+(?:been\s+)?(?:changed|updated|modified|rescheduled)|updated\s+(?:itinerary|reservation|booking|confirmation|check-?in)|revised\s+(?:itinerary|confirmation|check-?in|time|schedule|reservation)|(?:new|revised|updated)\s+(?:departure|arrival|check-?in|check-?out|pick-?up)\s+time|booking\s+(?:modification|update)|change\s+to\s+your\s+(?:booking|reservation|flight|trip|stay))\b/i;
const PENDING = /\b(?:on\s+hold|hold\s+expires|pending\s+confirmation|awaiting\s+confirmation|request\s+received|not\s+yet\s+confirmed|tentative|provisional)\b/i;
const TRAVEL_WORDS = /\b(?:flight|itinerary|e-?ticket|boarding|airline|hotel|check[\s-]?in|check[\s-]?out|reservation|booking|confirmation|car\s+rental|rental\s+car|train|rail|your\s+stay|your\s+trip|tickets?|tour|table\s+for)\b/i;
const FLIGHT_NUMBER = /(?<![\p{L}])(?:[Ff]light|FLIGHT|[Ff]lt\.?|FLT|[Vv]uelo|[Vv]oo|[Vv]ol)(?:\s+(?:[Nn]o\.?|[Nn]umber|#))?\s*:?\s*([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?-?(\d{1,4})(?![\d\p{L}])/gu;
const DEPART = /^(?:depart(?:ure|s|ing)?|from|leaves?|leaving|outbound)\b/i;
const ARRIVE = /^(?:arriv(?:al|es|e|ing)|to|lands?|landing)\b/i;
const CHECK_IN = /^(?:check[\s-]?in(?:\s+date)?|check-in\s+from)\b/i;
const CHECK_OUT = /^(?:check[\s-]?out(?:\s+date)?)\b/i;
const STAY_ARRIVAL = /^(?:arrival(?:\s+date)?|arriving)\b/i;
const STAY_DEPARTURE = /^(?:departure(?:\s+date)?|departing)\b/i;
const PICKUP = /^(?:pick[\s-]?up|collection|rental\s+start)\b/i;
const DROPOFF = /^(?:drop[\s-]?off|return(?:\s+(?:date|time|location))?|rental\s+end)\b/i;
const TRAVELER_LABEL = /^(?:passenger\s+names?|passengers?|travell?er\s+names?|travell?ers?|guest\s+names?|guests?|lead\s+guest|primary\s+guest|main\s+driver|additional\s+drivers?|drivers?|name|booked\s+for|reservation\s+name|reserved\s+for)\b/i;
const GENERIC_SENDER = /^(?:no[\s-]?reply|do[\s-]?not[\s-]?reply|donotreply|reservations?|bookings?|confirmations?|info|notifications?|support|customer\s+service|team|hello|travel|e-?tickets?)$/i;
const CAR_CONTEXT = /\b(?:car\s+rental|rental\s+car|car\s+hire|vehicle|rent\s+a\s+car|your\s+car|car\s+class|rental\s+agreement|rental\s+company)\b/i;
const TRAIN_CONTEXT = /\b(?:train|rail|railway|railways|platform|carriage|coach\s+\d)\b/i;
const LODGING_CONTEXT = /\b(?:hotel|stay|room|nights?|guest\s*house|inn|hostel|apartment|accommodation|property|lodge|suites?|check[\s-]?in)\b/i;
/** A "Label: value" line, which never names the booking itself. */
const LABEL_LINE = /^[\p{L} ]{2,30}:\s*\S/u;
const ACTIVITY_CONTEXT = /\b(?:reservation\s+at|table\s+for|tickets?|tour|admission|experience|class|show|concert|museum|restaurant|dinner|lunch|brunch|breakfast|party\s+of|tasting|excursion|activity)\b/i;

interface Context {
  text: string;
  lines: Line[];
  subject: string;
  reference: string;
  sender: string | null;
  travelers: { names: string[]; passages: string[] };
  references: { value: string; index: number; raw: string }[];
  status: "planned" | "confirmed" | "canceled";
  change: boolean;
  cancellation: boolean;
}

function senderLabel(name: string | null | undefined, address: string | null | undefined): string | null {
  const clean = name?.replace(/["']/g, "").trim();
  if (clean && !GENERIC_SENDER.test(clean) && !/@/.test(clean)) return clean.slice(0, 120);
  const domain = address?.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  const base = domain.split(".").filter((part) => !["mail", "email", "e", "info", "news", "bookings", "reservations", "noreply"].includes(part))[0];
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : null;
}

/** Remove dates, times, codes and filler from a place value, leaving the place name. */
function placeName(value: string, dates: FoundDate[], times: { raw: string }[]) {
  let label = value;
  for (const item of [...dates, ...times]) label = label.replace(item.raw, " ");
  label = label
    .replace(/\(([A-Z]{3})\)/g, " ")
    .replace(/\b(?:terminal|gate|platform|track|coach|seat)\s+[A-Z0-9][\w-]{0,3}\b/gi, " ")
    .replace(/\+\s?\d\s*(?:day)?s?\b/gi, " ")
    .replace(/\b(?:at|on|the|from|to|local\s+time|next\s+day)\b/gi, " ")
    .replace(/\b(?:after|before|from|until|by)\s*$/i, " ")
    .replace(/[|·•,;()\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return label.length >= 2 && label.length <= 120 ? label : null;
}

interface PlaceTime { code: string | null; label: string | null; date: FoundDate | null; time: string | null; nextDay: boolean; zone: string | null }
function placeTime(value: string, reference: string, options: { airports: boolean }): PlaceTime {
  const dates = findDates(value, reference);
  const times = findTimes(value);
  let code: string | null = null;
  if (options.airports) {
    const paren = /\(([A-Z]{3})\)/.exec(value);
    if (paren && isKnownAirport(paren[1])) code = paren[1];
    else code = [...value.matchAll(/(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])/g)].map((match) => match[1]).find(isKnownAirport) ?? null;
  }
  const rawLabel = placeName(code ? value.replace(new RegExp(`(?<![A-Za-z])${code}(?![A-Za-z])`, "g"), " ") : value, dates, times);
  const label = code ? airportCity(code) : rawLabel;
  const zone = code ? airport(code)!.zone : findCityZone(rawLabel)?.zone ?? null;
  return { code, label, date: dates[0] ?? null, time: times[0]?.time ?? null, nextDay: /\+\s?1\b|next\s+day/i.test(value), zone };
}

function localValue(date: string, time: string | null) {
  return time ? `${date}T${time}` : date;
}

function travelersOf(lines: Line[], from = 0, to = lines.length) {
  const names: string[] = [];
  const passages: string[] = [];
  for (let index = from; index < to; index++) {
    const match = TRAVELER_LABEL.exec(lines[index].text);
    if (!match) continue;
    const rest = lines[index].text.slice(match[0].length).replace(/^[\s:|#\-–]+/, "").trim();
    // "Name" alone is too generic unless followed by a colon.
    if (/^name$/i.test(match[0]) && !/^name\s*:/i.test(lines[index].text)) continue;
    const parts: string[] = [];
    passages.push(lines[index].text);
    if (rest) parts.push(rest);
    else {
      for (let next = index + 1; next < Math.min(to, index + 7); next++) {
        const text = lines[next].text;
        if (/:\s*\S/.test(text) && !/^\s*[-•*]/.test(text)) break;
        if (!cleanName(text)) break;
        parts.push(text);
        passages.push(text);
      }
    }
    for (const name of splitNames(parts.join("\n"))) if (!names.includes(name)) names.push(name);
  }
  return { names: names.slice(0, 20), passages };
}

function referenceNear(ctx: Context, start: number, end: number) {
  return ctx.references.find((item) => item.index >= start && item.index < end) ?? null;
}

function base(ctx: Context, kind: BookingKind, extra: Partial<BookingDraft>, passages: string[], missing: string[], ambiguous: ParsedBooking["ambiguous"]): ParsedBooking {
  const travelers = ctx.travelers.names;
  const draft: BookingDraft = {
    kind,
    status: ctx.status,
    travelers,
    ...extra,
  };
  if (!draft.reference) missing.push("reference");
  if (!travelers.length) missing.push("travelers");
  return {
    draft,
    passages: [...new Set([...passages, ...ctx.travelers.passages])].slice(0, 20),
    missing: [...new Set(missing)],
    ambiguous,
    change: ctx.change,
    cancellation: ctx.cancellation,
    method: "deterministic",
  };
}

function noteAmbiguity(ambiguous: ParsedBooking["ambiguous"], field: string, date: FoundDate | null) {
  if (date?.ambiguity) ambiguous.push({ field, reason: date.ambiguity });
}

// ─── Flights and trains ─────────────────────────────────────────────────────

interface Leg { segment: SegmentDraft | null; partial: Partial<SegmentDraft>; passages: string[]; missing: string[]; ambiguous: ParsedBooking["ambiguous"]; start: number; end: number }

function journeyLeg(ctx: Context, block: string, blockStart: number, number: string | null, airports: boolean, prefix: string): Leg | null {
  const lines = splitLines(block);
  const passages: string[] = [];
  const missing: string[] = [];
  const ambiguous: ParsedBooking["ambiguous"] = [];
  const departure = labeled(lines, DEPART, { follow: 2 });
  const arrival = labeled(lines, ARRIVE, { from: departure ? departure.line + 1 : 0, follow: 2 });
  let from: PlaceTime | null = departure ? placeTime(departure.value, ctx.reference, { airports }) : null;
  let to: PlaceTime | null = arrival ? placeTime(arrival.value, ctx.reference, { airports }) : null;
  if (departure) passages.push(...departure.passages);
  if (arrival) passages.push(...arrival.passages);
  if ((!from?.code || !to?.code) && airports) {
    // A route line such as "DEN → LIS" or "Denver (DEN) to Lisbon (LIS)".
    for (const line of lines) {
      const route = /(?<![A-Za-z])([A-Z]{3})\)?\s*(?:→|->|—|–|-|to|›|>)\s*(?:[\p{L} .]+\()?([A-Z]{3})(?![A-Za-z])/u.exec(line.text);
      if (route && isKnownAirport(route[1]) && isKnownAirport(route[2])) {
        const times = findTimes(line.text);
        const dates = findDates(line.text, ctx.reference);
        from ??= { code: null, label: null, date: dates[0] ?? null, time: times[0]?.time ?? null, nextDay: false, zone: null };
        to ??= { code: null, label: null, date: dates[1] ?? null, time: times[1]?.time ?? null, nextDay: /\+\s?1\b/.test(line.text), zone: null };
        from = { ...from, code: route[1], label: airportCity(route[1]), zone: airport(route[1])!.zone };
        to = { ...to, code: route[2], label: airportCity(route[2]), zone: airport(route[2])!.zone };
        passages.push(line.text);
        break;
      }
    }
  }
  if (!from && !to) return null;
  // A date written once for the leg applies to its departure.
  const blockDates = findDates(block, ctx.reference);
  const departDate = from?.date ?? blockDates[0] ?? null;
  if (!from?.date && departDate) passages.push(lines.find((line) => line.text.includes(departDate.raw))?.text ?? departDate.raw);
  if (!departDate) missing.push(`${prefix}startLocal`);
  noteAmbiguity(ambiguous, `${prefix}startLocal`, departDate);
  if (!from?.time) missing.push(`${prefix}startTime`);
  if (!from?.label && !from?.code) missing.push(`${prefix}originLabel`);
  if (!to?.label && !to?.code) missing.push(`${prefix}destinationLabel`);
  const partial: Partial<SegmentDraft> = { number, originLabel: from?.label ?? null, originCode: from?.code ?? null, destinationLabel: to?.label ?? null, destinationCode: to?.code ?? null, startZone: from?.zone ?? null, endZone: to?.zone ?? null };
  if (!departDate) return { segment: null, partial, passages, missing, ambiguous, start: blockStart, end: blockStart + block.length };
  let arriveDate = to?.date?.date ?? (to?.nextDay ? addDays(departDate.date, 1) : departDate.date);
  noteAmbiguity(ambiguous, `${prefix}endLocal`, to?.date ?? null);
  const startLocal = localValue(departDate.date, from?.time ?? null);
  let endLocal: string | null = to?.time ? localValue(arriveDate, to.time) : to?.date ? to.date.date : null;
  // An arrival that would precede its departure lands on a later day.
  if (endLocal && endLocal.length > 10 && !to?.date && !to?.nextDay && from?.time) {
    const start = resolveEndpoint(startLocal, from.zone);
    const end = resolveEndpoint(endLocal, to!.zone);
    if (start.instant && end.instant && end.instant < start.instant) {
      arriveDate = addDays(arriveDate, 1);
      endLocal = localValue(arriveDate, to!.time);
    } else if (!start.instant && endLocal < startLocal) {
      arriveDate = addDays(arriveDate, 1);
      endLocal = localValue(arriveDate, to!.time);
      ambiguous.push({ field: `${prefix}endLocal`, reason: "The arrival date is not stated. The next day is assumed because the arrival time is earlier than departure." });
    }
  }
  if (!to?.time) missing.push(`${prefix}endTime`);
  const segment: SegmentDraft = {
    number,
    originLabel: from?.label ?? null,
    originCode: from?.code ?? null,
    destinationLabel: to?.label ?? null,
    destinationCode: to?.code ?? null,
    startLocal,
    startZone: from?.zone ?? null,
    endLocal,
    endZone: to?.zone ?? null,
  };
  return { segment, partial, passages, missing, ambiguous, start: blockStart, end: blockStart + block.length };
}

function flights(ctx: Context): ParsedBooking[] {
  const matches = [...ctx.text.matchAll(FLIGHT_NUMBER)];
  if (!matches.length) return [];
  const legs: (Leg & { number: string; carrier: string })[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const number = `${match[1]} ${match[2]}`;
    if (seen.has(number)) continue;
    const start = match.index!;
    const nextDifferent = matches.slice(index + 1).find((item) => `${item[1]} ${item[2]}` !== number);
    const end = Math.min(nextDifferent?.index ?? ctx.text.length, start + 1500);
    const block = ctx.text.slice(start, end);
    const leg = journeyLeg(ctx, block, start, number, true, `segments.${legs.length}.`);
    if (!leg) continue;
    seen.add(number);
    leg.passages.unshift(ctx.lines.find((line) => line.index <= start && start < line.index + line.text.length)?.text ?? match[0]);
    legs.push({ ...leg, number, carrier: match[1] });
  }
  if (!legs.length) return [];
  // Legs that cite their own reference become separate bookings. Others share the first reference.
  const groups = new Map<string, typeof legs>();
  for (const leg of legs) {
    const key = referenceNear(ctx, leg.start, leg.end)?.value ?? ctx.references[0]?.value ?? "";
    groups.set(key, [...(groups.get(key) ?? []), leg]);
  }
  const airline = labeled(ctx.lines, /^(?:airline|carrier|operated\s+by)\b/i, { follow: 1 });
  return [...groups.entries()].map(([reference, group]) => {
    const passages = group.flatMap((leg) => leg.passages);
    const ref = ctx.references.find((item) => item.value === reference);
    if (ref) passages.push(ctx.lines.find((line) => line.index <= ref.index && ref.index < line.index + line.text.length)?.text ?? ref.raw);
    if (airline) passages.push(...airline.passages);
    const missing = group.flatMap((leg, index) => leg.missing.map((field) => field.replace(/^segments\.\d+\./, `segments.${index}.`)));
    const ambiguous = group.flatMap((leg, index) => leg.ambiguous.map((item) => ({ ...item, field: item.field.replace(/^segments\.\d+\./, `segments.${index}.`) })));
    const provider = airline?.value.replace(/\s*\(.*$/, "").slice(0, 120) || ctx.sender;
    const complete = group.every((leg) => leg.segment);
    const parsed = base(ctx, "flight", {
      title: `Flight ${group[0].number}`,
      provider: provider ?? null,
      providerCode: group[0].carrier,
      reference: reference || null,
      segments: complete ? group.map((leg) => leg.segment!) : [],
    }, passages, missing, ambiguous);
    if (!complete) parsed.partial = { segments: group.map((leg) => leg.segment ?? leg.partial) };
    return parsed;
  });
}

function trains(ctx: Context, hasFlights: boolean): ParsedBooking[] {
  if (hasFlights || !TRAIN_CONTEXT.test(`${ctx.subject}\n${ctx.text}`)) return [];
  const numberLine = labeled(ctx.lines, /^(?:train|service)(?:\s+(?:no\.?|number|#))?\b/i, { follow: 1 });
  const leg = journeyLeg(ctx, ctx.text, 0, null, false, "segments.0.");
  if (!leg || !leg.segment) return [];
  if (!leg.segment.originLabel && !leg.segment.destinationLabel) return [];
  const number = numberLine?.value.split(/\s{2,}|\||,/)[0].trim().slice(0, 40) || null;
  if (numberLine) leg.passages.unshift(...numberLine.passages);
  const operator = labeled(ctx.lines, /^(?:operator|operated\s+by|rail\s+company)\b/i, { follow: 1 });
  if (operator) leg.passages.push(...operator.passages);
  const ref = ctx.references[0];
  if (ref) leg.passages.push(ctx.lines.find((line) => line.index <= ref.index && ref.index < line.index + line.text.length)?.text ?? ref.raw);
  const segment = { ...leg.segment, number };
  const origin = segment.originLabel ?? "Train";
  const destination = segment.destinationLabel;
  const seat = labeled(ctx.lines, /^(?:seat|coach|carriage|class)\b/i, { follow: 1 });
  return [base(ctx, "train", {
    title: number ? `Train ${number}`.replace(/^Train (Train|Service) /i, "Train ") : destination ? `${origin} to ${destination}` : "Train",
    provider: operator?.value.slice(0, 120) || ctx.sender,
    reference: ref?.value ?? null,
    segments: [segment],
    detail: seat ? seat.passages[0].slice(0, 120) : null,
  }, leg.passages, leg.missing, leg.ambiguous)];
}

// ─── Lodging ────────────────────────────────────────────────────────────────

const PROPERTY_LABEL = /^(?:hotel|property|accommodation|where\s+you(?:'|’)re\s+staying|lodging|apartment|your\s+hotel|hotel\s+name|property\s+name)\b/i;
const STAY_SUBJECT = /(?:stay|reservation|booking|confirmation)\s+(?:at|in|for)\s+([\p{L}\d'’&.\- ]{2,80}?)(?:\s+(?:is|has|was|for|from|on)\b|[,.!|:]|\s+-\s|$)/iu;

function stays(ctx: Context, hasJourneys: boolean): ParsedBooking[] {
  const all = `${ctx.subject}\n${ctx.text}`;
  if (!LODGING_CONTEXT.test(all)) return [];
  let checkIns = ctx.lines.map((line, index) => (CHECK_IN.test(line.text) ? index : -1)).filter((index) => index >= 0);
  let inLabel = CHECK_IN, outLabel = CHECK_OUT;
  if (!checkIns.length && !hasJourneys) {
    checkIns = ctx.lines.map((line, index) => (STAY_ARRIVAL.test(line.text) ? index : -1)).filter((index) => index >= 0);
    inLabel = STAY_ARRIVAL;
    outLabel = STAY_DEPARTURE;
  }
  const results: ParsedBooking[] = [];
  for (let n = 0; n < checkIns.length && n < 4; n++) {
    const from = checkIns[n];
    const to = checkIns[n + 1] ?? ctx.lines.length;
    const checkIn = labeled(ctx.lines, inLabel, { from, to, follow: 2 });
    if (!checkIn) continue;
    const checkOut = labeled(ctx.lines, outLabel, { from: from + 1, to, follow: 2 }) ?? labeled(ctx.lines, outLabel, { from: 0, to: from, follow: 2 });
    const passages = [...checkIn.passages];
    const missing: string[] = [];
    const ambiguous: ParsedBooking["ambiguous"] = [];
    const inDates = findDates(checkIn.value, ctx.reference);
    const inTimes = findTimes(checkIn.value);
    if (!inDates.length) continue;
    noteAmbiguity(ambiguous, "stay.checkInDate", inDates[0]);
    let checkOutDate: string | null = null;
    let checkOutTime: string | null = null;
    if (checkOut) {
      const outDates = findDates(checkOut.value, ctx.reference);
      const outTimes = findTimes(checkOut.value);
      if (outDates.length) {
        checkOutDate = outDates[0].date;
        noteAmbiguity(ambiguous, "stay.checkOutDate", outDates[0]);
        passages.push(...checkOut.passages);
      }
      checkOutTime = outTimes[0]?.time ?? null;
    }
    const nightsLine = ctx.lines.slice(Math.max(0, from - 4), to).find((line) => /\b(\d{1,2})\s+nights?\b/i.test(line.text));
    const nights = nightsLine ? Number(/\b(\d{1,2})\s+nights?\b/i.exec(nightsLine.text)![1]) : null;
    if (!checkOutDate && nights && nights > 0) {
      checkOutDate = addDays(inDates[0].date, nights);
      passages.push(nightsLine!.text);
    } else if (nightsLine) passages.push(nightsLine.text);
    if (!checkOutDate) missing.push("stay.checkOutDate");
    if (checkOutDate && checkOutDate <= inDates[0].date) {
      ambiguous.push({ field: "stay.checkOutDate", reason: "The check-out date is not after check-in." });
      checkOutDate = null;
    }
    // Property name: an explicit label, the subject, or the sender.
    const propertyLine = labeled(ctx.lines, PROPERTY_LABEL, { from: n === 0 ? 0 : checkIns[n - 1], to, follow: 1 });
    let propertyName = propertyLine?.value.split(/\s{2,}|\|/)[0].trim().slice(0, 120) || null;
    if (propertyLine && propertyName) passages.push(...propertyLine.passages);
    if (!propertyName) {
      const subjectMatch = STAY_SUBJECT.exec(ctx.subject);
      if (subjectMatch) {
        propertyName = subjectMatch[1].trim();
        const subjectLine = ctx.lines.find((line) => line.text.includes(subjectMatch[0].trim()));
        if (subjectLine) passages.push(subjectLine.text);
      }
    }
    if (!propertyName && ctx.sender) propertyName = ctx.sender;
    if (!propertyName) {
      // Pasted text often starts with the property's name.
      const first = ctx.lines.find((line) => !LABEL_LINE.test(line.text) && !/^subject:/i.test(line.text));
      if (first && first.text.length <= 80 && !/\d/.test(first.text) && /^[\p{Lu}]/u.test(first.text) && first.text.split(/\s+/).length <= 6) { propertyName = first.text; passages.push(first.text); }
    }
    if (!propertyName) missing.push("stay.propertyName");
    const addressLine = labeled(ctx.lines, /^(?:address|location|hotel\s+address|property\s+address)\b/i, { from: n === 0 ? 0 : checkIns[n - 1], to, follow: 2 });
    const address = addressLine?.value.slice(0, 300) || null;
    if (addressLine && address) passages.push(...addressLine.passages);
    const zone = findCityZone(address)?.zone ?? findCityZone(propertyName)?.zone ?? null;
    const room = labeled(ctx.lines, /^(?:room(?:\s+type)?|unit)\b/i, { from: n === 0 ? 0 : checkIns[n - 1], to, follow: 1 });
    const ref = referenceNear(ctx, ctx.lines[from].index - 600, ctx.lines[to - 1]?.index ?? ctx.text.length) ?? ctx.references[0];
    if (ref) passages.push(ctx.lines.find((line) => line.index <= ref.index && ref.index < line.index + line.text.length)?.text ?? ref.raw);
    const stay: StayDraft | null = checkOutDate && propertyName ? {
      propertyName,
      address,
      checkInDate: inDates[0].date,
      checkOutDate,
      checkInTime: inTimes[0]?.time ?? null,
      checkOutTime,
      zone,
    } : null;
    if (!stay) {
      const parsed = base(ctx, "lodging", { title: propertyName ?? "Stay", provider: propertyName ?? ctx.sender, reference: ref?.value ?? null, stay: null }, passages, missing, ambiguous);
      parsed.partial = { stay: { propertyName: propertyName ?? undefined, address, checkInDate: inDates[0].date, checkInTime: inTimes[0]?.time ?? null, checkOutTime, zone } };
      results.push(parsed);
      continue;
    }
    results.push(base(ctx, "lodging", {
      title: propertyName!,
      provider: ctx.sender && ctx.sender !== propertyName ? ctx.sender : propertyName,
      reference: ref?.value ?? null,
      stay,
      detail: room ? room.value.slice(0, 120) : null,
    }, passages, missing, ambiguous));
  }
  return results;
}

// ─── Car rental ─────────────────────────────────────────────────────────────

function cars(ctx: Context): ParsedBooking[] {
  if (!CAR_CONTEXT.test(`${ctx.subject}\n${ctx.text}`)) return [];
  const pickup = labeled(ctx.lines, PICKUP, { follow: 2 });
  if (!pickup) return [];
  const dropoff = labeled(ctx.lines, DROPOFF, { from: pickup.line + 1, follow: 2 });
  const passages = [...pickup.passages, ...(dropoff?.passages ?? [])];
  const missing: string[] = [];
  const ambiguous: ParsedBooking["ambiguous"] = [];
  const start = placeTime(pickup.value, ctx.reference, { airports: true });
  const end = dropoff ? placeTime(dropoff.value, ctx.reference, { airports: true }) : null;
  if (!start.date) return [];
  noteAmbiguity(ambiguous, "segments.0.startLocal", start.date);
  noteAmbiguity(ambiguous, "segments.0.endLocal", end?.date ?? null);
  if (!end?.date) missing.push("segments.0.endLocal");
  if (!start.time) missing.push("segments.0.startTime");
  const company = labeled(ctx.lines, /^(?:rental\s+company|supplier|company|provided\s+by|car\s+rental\s+company)\b/i, { follow: 1 });
  if (company) passages.push(...company.passages);
  const vehicle = labeled(ctx.lines, /^(?:vehicle|car(?:\s+(?:class|type|group))?)\b/i, { follow: 1 });
  const ref = ctx.references[0];
  if (ref) passages.push(ctx.lines.find((line) => line.index <= ref.index && ref.index < line.index + line.text.length)?.text ?? ref.raw);
  const provider = company?.value.slice(0, 120) || ctx.sender;
  const pickupLabel = start.code ? `${airportCity(start.code)} airport (${start.code})` : start.label;
  const returnLabel = end?.code ? `${airportCity(end.code)} airport (${end.code})` : end?.label ?? null;
  return [base(ctx, "car", {
    title: provider ? (/\b(rental|hire|rent)\b/i.test(provider) ? provider : `${provider} car rental`) : "Car rental",
    provider: provider ?? null,
    reference: ref?.value ?? null,
    segments: [{
      number: null,
      originLabel: pickupLabel,
      originCode: start.code,
      destinationLabel: returnLabel ?? pickupLabel,
      destinationCode: end?.code ?? null,
      startLocal: localValue(start.date.date, start.time),
      startZone: start.zone,
      endLocal: end?.date ? localValue(end.date.date, end.time) : null,
      endZone: end?.zone ?? start.zone,
    }],
    detail: vehicle ? vehicle.value.slice(0, 120) : null,
  }, passages, missing, ambiguous)];
}

// ─── Activities and restaurants ─────────────────────────────────────────────

function activities(ctx: Context): ParsedBooking[] {
  const all = `${ctx.subject}\n${ctx.text}`;
  if (!ACTIVITY_CONTEXT.test(all)) return [];
  const passages: string[] = [];
  const missing: string[] = [];
  const ambiguous: ParsedBooking["ambiguous"] = [];
  const when = labeled(ctx.lines, /^(?:date(?:\s+and\s+time)?|when|day|time|start(?:s|\s+time)?)\b/i, { follow: 2 });
  let dateFound: FoundDate | null = null;
  let time: string | null = null;
  if (when) {
    dateFound = findDates(when.value, ctx.reference)[0] ?? null;
    time = findTimes(when.value)[0]?.time ?? null;
    passages.push(...when.passages);
  }
  if (!dateFound) {
    for (const line of ctx.lines) {
      const dates = findDates(line.text, ctx.reference);
      if (dates.length) { dateFound = dates[0]; time ??= findTimes(line.text)[0]?.time ?? null; passages.push(line.text); break; }
    }
  }
  if (!dateFound) return [];
  if (!time) {
    const timeLine = labeled(ctx.lines, /^(?:time|at)\b/i, { follow: 1 });
    if (timeLine) { time = findTimes(timeLine.value)[0]?.time ?? null; if (time) passages.push(...timeLine.passages); }
  }
  noteAmbiguity(ambiguous, "segments.0.startLocal", dateFound);
  const venueLine = labeled(ctx.lines, /^(?:restaurant|venue|event|tour|activity|experience|attraction|museum)\b/i, { follow: 1 });
  let title = venueLine?.value.split(/\s{2,}|\|/)[0].trim().slice(0, 120) || null;
  if (venueLine && title) passages.push(...venueLine.passages);
  if (!title) {
    const at = /(?:reservation|table|booking|tickets?)\s+(?:at|for)\s+([\p{L}\d'’&.\- ]{2,60}?)(?:\s+(?:is|has|on|for)\b|[,.!|:]|$)/imu.exec(all);
    if (at && !/^(one|two|\d+)\b/i.test(at[1])) {
      title = at[1].trim();
      const line = ctx.lines.find((item) => item.text.includes(at[0].trim()));
      if (line) passages.push(line.text);
    }
  }
  if (!title && !ctx.subject) {
    // A pasted note often starts with what it is, such as "Sintra palace tickets".
    const first = ctx.lines.find((line) => !LABEL_LINE.test(line.text));
    if (first && first.text.length <= 80 && !/\d{2}/.test(first.text)) { title = first.text; passages.push(first.text); }
  }
  if (!title && ctx.subject) title = ctx.subject.replace(/^(?:re|fwd?|fw)\s*:\s*/i, "").replace(/\b(?:confirmation|confirmed|your|reservation|booking)\b[:\s]*/gi, " ").replace(/\s+/g, " ").trim().slice(0, 80) || null;
  if (title) {
    // "Dinner at Mesa" reads better than the venue alone when the source names the meal.
    const meal = /\b(dinner|lunch|brunch|breakfast)\b/i.exec(all);
    if (meal && !new RegExp(`\\b${meal[1]}\\b`, "i").test(title)) title = `${meal[1].charAt(0).toUpperCase()}${meal[1].slice(1).toLowerCase()} at ${title}`;
  } else missing.push("title");
  const locationLine = labeled(ctx.lines, /^(?:address|location|where|meeting\s+point)\b/i, { follow: 2 });
  if (locationLine) passages.push(...locationLine.passages);
  const party = ctx.lines.find((line) => /\b(?:table\s+for\s+\w+|party\s+of\s+\d+|\d+\s+(?:guests|tickets|adults|people))\b/i.test(line.text));
  if (party) passages.push(party.text);
  const detail = party ? /\b(table\s+for\s+\w+|party\s+of\s+\d+|\d+\s+(?:guests|tickets|adults|people))\b/i.exec(party.text)![1] : null;
  if (!time) missing.push("segments.0.startTime");
  const address = locationLine?.value.slice(0, 300) || null;
  const zone = findCityZone(address)?.zone ?? null;
  const ref = ctx.references[0];
  if (ref) passages.push(ctx.lines.find((line) => line.index <= ref.index && ref.index < line.index + line.text.length)?.text ?? ref.raw);
  return [base(ctx, "activity", {
    title: title ?? "Reservation",
    provider: ctx.sender && ctx.sender !== title ? ctx.sender : title,
    reference: ref?.value ?? null,
    segments: [{ number: null, startLocal: localValue(dateFound.date, time), startZone: zone, endLocal: null, endZone: null, address }],
    detail: detail ? detail.charAt(0).toUpperCase() + detail.slice(1) : null,
  }, passages, missing, ambiguous)];
}

// ─── Calendar invitations inside mail ───────────────────────────────────────

function inviteValue(value: string | null): { local: string; zone: string | null; offset: number | null } | null {
  if (!value) return null;
  const zoned = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}\[([^\]]+)\]$/.exec(value);
  if (zoned) return { local: `${zoned[1]}T${zoned[2]}`, zone: zoned[3], offset: null };
  const utc = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}Z$/.exec(value);
  if (utc) return { local: `${utc[1]}T${utc[2]}`, zone: null, offset: 0 };
  const floating = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}$/.exec(value);
  if (floating) return { local: `${floating[1]}T${floating[2]}`, zone: null, offset: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { local: value, zone: null, offset: null };
  return null;
}

function fromInvite(ctx: Context, invite: ParseInvite): ParsedBooking[] {
  const summary = invite.summary ?? "";
  const kind: BookingKind | null = /\b(flight|fly|airline)\b|✈/i.test(summary) ? "flight" : /\b(hotel|stay|check[\s-]?in|lodging)\b/i.test(summary) ? "lodging" : /\b(train|rail)\b/i.test(summary) ? "train" : /\b(car|rental)\b/i.test(summary) ? "car" : /\b(reservation|dinner|lunch|tour|tickets?|table|museum|show)\b/i.test(summary) ? "activity" : null;
  if (!kind) return [];
  const start = inviteValue(invite.start);
  const end = inviteValue(invite.end);
  if (!start) return [];
  const passages = [summary].filter(Boolean);
  const missing: string[] = [];
  const canceled = invite.method === "CANCEL" || invite.status === "CANCELLED";
  const number = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/.exec(summary);
  if (kind === "lodging") {
    const checkOut = end && end.local.slice(0, 10) > start.local.slice(0, 10) ? end.local.slice(0, 10) : null;
    if (!checkOut) missing.push("stay.checkOutDate");
    const name = summary.replace(/^(?:stay|hotel|check[\s-]?in)\s*(?:at|:)?\s*/i, "").trim() || "Stay";
    return [{ ...base({ ...ctx, cancellation: canceled, status: canceled ? "canceled" : ctx.status }, "lodging", { title: name, provider: name, reference: ctx.references[0]?.value ?? null, stay: checkOut ? { propertyName: name, address: null, checkInDate: start.local.slice(0, 10), checkOutDate: checkOut, checkInTime: start.local.length > 10 ? start.local.slice(11) : null, checkOutTime: null, zone: start.zone } : null }, passages, missing, []), method: "invite" }];
  }
  return [{ ...base({ ...ctx, cancellation: canceled, status: canceled ? "canceled" : ctx.status }, kind, {
    title: summary.slice(0, 120) || "Calendar invitation",
    provider: ctx.sender,
    providerCode: kind === "flight" && number ? number[1] : null,
    reference: ctx.references[0]?.value ?? null,
    segments: [{ number: number ? `${number[1]} ${number[2]}` : null, startLocal: start.local, startZone: start.zone, startOffset: start.offset, endLocal: end?.local ?? null, endZone: end?.zone ?? null, endOffset: end?.offset ?? null }],
  }, passages, missing, []), method: "invite" }];
}

/** Fill zones the text did not state from a provider invitation for the same times. */
function fillFromInvite(bookings: ParsedBooking[], invite: ParseInvite | null | undefined) {
  if (!invite) return;
  const start = inviteValue(invite.start), end = inviteValue(invite.end);
  for (const booking of bookings) {
    for (const segment of booking.draft.segments ?? []) {
      if (start?.zone && !segment.startZone && segment.startLocal === start.local) segment.startZone = start.zone;
      if (end?.zone && !segment.endZone && segment.endLocal === end.local) segment.endZone = end.zone;
    }
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

/** Read every booking a confirmation describes. Never invents a field. */
export function parseConfirmation(input: ParseInput): ParseResult {
  const text = input.text.replace(/\r\n?/g, "\n").replace(/ /g, " ");
  const subject = (input.subject ?? "").trim();
  const reference = (input.receivedAt && !Number.isNaN(Date.parse(input.receivedAt)) ? new Date(input.receivedAt) : new Date()).toISOString().slice(0, 10);
  const forwarded = FORWARD_MARKER.test(text) || FORWARD_SUBJECT.test(subject);
  let sender = senderLabel(input.senderName, input.senderAddress);
  if (forwarded) {
    // The provider is the original sender inside the forwarded block, not the person who forwarded it.
    const original = /^From:\s*"?([^"<\n]+?)"?\s*<([^>\n]+)>/m.exec(text.slice(text.search(FORWARD_MARKER) >= 0 ? text.search(FORWARD_MARKER) : 0));
    sender = original ? senderLabel(original[1], original[2]) : null;
  }
  const lines = splitLines(text);
  const head = `${subject}\n${lines.slice(0, 12).map((line) => line.text).join("\n")}`;
  const cancellation = CANCEL.test(subject) || CANCEL.test(head) || CANCEL.test(text.slice(0, 3000));
  const change = !cancellation && (CHANGE.test(subject) || CHANGE.test(text.slice(0, 4000)));
  const status = cancellation ? "canceled" : PENDING.test(`${subject}\n${text.slice(0, 4000)}`) ? "planned" : "confirmed";
  const ctx: Context = {
    text, lines, subject, reference, sender,
    travelers: travelersOf(lines),
    references: findReferences(text),
    status, change, cancellation,
  };
  let bookings = flights(ctx);
  bookings.push(...trains(ctx, bookings.length > 0));
  bookings.push(...stays(ctx, bookings.length > 0));
  bookings.push(...cars(ctx));
  if (!bookings.length) bookings = activities(ctx);
  fillFromInvite(bookings, input.invite);
  if (!bookings.length && input.invite) bookings = fromInvite(ctx, input.invite);
  const notes: string[] = [];
  if (!bookings.length && cancellation && ctx.references.length) {
    // A cancellation often states only the reference. It can match an existing booking but never creates one.
    const all = `${subject}\n${text}`;
    const known: BookingKind | null = /\b(flight|airline|boarding)\b/i.test(all) ? "flight" : /\b(hotel|stay|room|check[\s-]?in)\b/i.test(all) ? "lodging" : /\b(car|rental|vehicle)\b/i.test(all) ? "car" : /\b(train|rail)\b/i.test(all) ? "train" : /\b(table|tickets?|tour|restaurant|dinner|lunch)\b/i.test(all) ? "activity" : null;
    const kind: BookingKind = known ?? "activity";
    const ref = ctx.references[0];
    const line = lines.find((item) => item.index <= ref.index && ref.index < item.index + item.text.length)?.text ?? ref.raw;
    const cancelLine = lines.find((item) => CANCEL.test(item.text))?.text;
    const parsed = base(ctx, kind, { title: subject.slice(0, 120) || "Canceled reservation", provider: sender, reference: ref.value }, [line, ...(cancelLine ? [cancelLine] : [])], [], []);
    if (!known) parsed.kindGuessed = true;
    bookings = [parsed];
  }
  const travelLike = TRAVEL_WORDS.test(subject) || (TRAVEL_WORDS.test(text.slice(0, 4000)) && (ctx.references.length > 0 || findDates(text.slice(0, 4000), reference).length > 0));
  if (!bookings.length) notes.push(travelLike ? "This reads like a travel confirmation, but no booking details could be read from it." : "No booking details were found.");
  return { bookings: bookings.slice(0, 10), forwarded, travelLike, notes };
}

/** True when a draft has what a booking needs to appear in an itinerary. */
export function isComplete(parsed: ParsedBooking): boolean {
  const draft = parsed.draft;
  if (draft.kind === "lodging") return !!draft.stay;
  return !!draft.segments?.length && draft.segments.every((segment) => !!segment.startLocal);
}
