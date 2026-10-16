/**
 * Deterministic reading of job-search mail before any AI: what kind of
 * message it is, which role titles, requisition IDs, links and companies it
 * names, and an explicitly stated interview time with its zone. Rules prefer
 * leaving a message as "other" over guessing a stage.
 */
import type { Classification } from './model.js';
import { cleanTitle, extractRequisitionIds, extractUrls, normalizePhrase, passageAround } from './text.js';

export interface MessageFacts {
  subject: string;
  text: string;
  sent: boolean;
  fromName?: string | null;
  invite?: { method: string | null; status: string | null; sequence: number | null; start: string | null; end: string | null; summary: string | null; uid: string | null } | null;
}

export interface Classified {
  classification: Classification;
  /** The exact passage that decided the classification, when one did. */
  passage: string | null;
}

const OFFER = /\b(?:pleased|happy|excited|delighted|thrilled) to (?:extend|offer|share (?:an|the|your) offer)\b|\boffer letter\b|\b(?:formal|written|verbal) offer\b|\boffer of employment\b|\bextend(?:ing)? (?:you )?an offer\b|\byour offer (?:details|package)\b/i;
const REJECTION = /\b(?:not|won't|will not|unable to) (?:be )?(?:moving|move|proceeding|proceed|progressing|progress)(?: forward)? with your (?:application|candidacy)\b|\bnot (?:be )?(?:moving|proceeding|progressing) forward\b|\bdecided (?:not )?to (?:move|proceed|go)(?: forward)? with (?:other|another) candidates?\b|\bpursue other candidates\b|\b(?:position|role) has (?:now )?been filled\b|\bregret to inform\b|\bnot (?:been )?selected\b|\bno longer (?:under consideration|being considered)\b|\bunable to offer you\b|\bwill not be (?:moving|offering)\b/i;
const CANCEL = /\b(?:cancel(?:l)?ed|cancel(?:l)?ing|cancel|cancellation of)\b[^.\n]{0,60}\b(?:interview|call|meeting|conversation|chat|screen|discussion)\b|\b(?:interview|call|meeting|conversation|chat|screen|discussion)\b[^.\n]{0,40}\b(?:has been|is|was) cancel(?:l)?ed\b|^\s*cancel(?:l)?ed(?: event| invitation)?:/im;
const RESCHEDULE = /\breschedul(?:e|ed|ing)\b|\bnew time\b|\bmov(?:e|ed|ing) (?:our|the|your) (?:interview|call|meeting|conversation|chat)\b|^\s*updated invitation(?: with note)?:/im;
const CONFIRMED = /\b(?:interview|call|conversation|discussion|meeting|chat|screen)\b[^.\n]{0,40}\b(?:is|has been|was) (?:confirmed|scheduled|booked)\b|\bconfirm(?:ed|ing) (?:your|the|our) (?:interview|call|meeting|conversation|time)\b|\blook forward to (?:speaking|talking|meeting|discussing|chatting)\b[^.\n]{0,120}\bon (?:mon|tues|wednes|thurs|fri|satur|sun)day\b|^\s*invitation:/im;
const SCHEDULING = /\b(?:share|send|provide|let (?:us|me) know) (?:us |me )?(?:your|some) availability\b|\byour availability\b|\b(?:choose|pick|select|book|grab) (?:a|an|your) (?:time|slot|time slot)\b|\bschedul(?:e|ing) (?:a|an|your|the) (?:time|interview|call|chat|conversation|screen)\b|\bcalendly\.com\b|\bwhat times? (?:work|works)\b|\bwhen (?:are you|would you be) available\b|\bfind a time\b|\bbook (?:a|your) (?:time|interview)\b/i;
const ACKNOWLEDGMENT = /\bthank(?:s| you) for (?:applying|your application|submitting your application)\b|\b(?:we(?:'ve| have)? )?(?:successfully )?received your application\b|\byour application (?:has been|was) (?:received|submitted)\b|\bapplication (?:received|submitted|confirmation)\b|\bthank(?:s| you) for your interest in (?:the|our|joining)\b/i;
const SENT_APPLICATION = /\b(?:apply|applying|application|my (?:resume|résumé|cv)|cover letter|attached (?:my )?(?:resume|résumé|cv))\b/i;
const RECRUITER = /\b(?:recruiter|talent (?:partner|acquisition|team)|sourcer|hiring manager|recruiting team)\b|\breaching out\b[^.\n]{0,80}\b(?:role|position|opportunity)\b/i;
const JOB_WORDS = /\b(?:application|applied|applying|interview|recruit(?:er|ing)|candidate|candidacy|position|opening|opportunit(?:y|ies)|offer|hiring|résumé|resume|\bcv\b|cover letter|job)\b/i;

function first(pattern: RegExp, ...texts: string[]): string | null {
  for (const text of texts) {
    const match = pattern.exec(text);
    if (match) return passageAround(text, match.index ?? 0);
  }
  return null;
}

/** Classify one message by explicit wording and invitation data. Order matters: offers and rejections need their own phrases. */
export function classifyMessage(facts: MessageFacts): Classified {
  const { subject, text } = facts;
  const invite = facts.invite;
  if (facts.sent) {
    const passage = first(SENT_APPLICATION, subject, text);
    return { classification: passage ? 'sent_application' : 'other', passage };
  }
  if (invite) {
    const method = (invite.method ?? '').toUpperCase();
    const status = (invite.status ?? '').toUpperCase();
    if (method === 'CANCEL' || status === 'CANCELLED') return { classification: 'cancellation', passage: invite.summary ?? subject };
    if (method === 'REQUEST' || method === 'PUBLISH' || !method) {
      if ((invite.sequence ?? 0) > 0 || RESCHEDULE.test(subject)) return { classification: 'reschedule', passage: invite.summary ?? subject };
      return { classification: 'interview_confirmed', passage: invite.summary ?? subject };
    }
  }
  const checks: [Classification, RegExp][] = [
    ['offer', OFFER],
    ['rejection', REJECTION],
    ['cancellation', CANCEL],
    ['reschedule', RESCHEDULE],
    ['interview_confirmed', CONFIRMED],
    ['scheduling', SCHEDULING],
    ['acknowledgment', ACKNOWLEDGMENT],
    ['recruiter', RECRUITER],
  ];
  for (const [classification, pattern] of checks) {
    const passage = first(pattern, subject, text);
    if (passage) return { classification, passage };
  }
  return { classification: 'other', passage: null };
}

/** True when a subject or snippet looks like job-search mail worth reading in full. */
export function looksJobRelated(...texts: string[]): boolean {
  return texts.some((text) => JOB_WORDS.test(text) || ACKNOWLEDGMENT.test(text) || SCHEDULING.test(text) || OFFER.test(text) || REJECTION.test(text));
}

// ─── Role titles and companies ──────────────────────────────────────────────

const TITLE_NOUN = /(designer|engineer|developer|manager|lead|director|analyst|scientist|specialist|coordinator|consultant|architect|researcher|writer|head of [a-z ]+|vp[a-z ,]*|vice president[a-z ,]*|principal|associate|intern|officer|administrator|strategist|marketer|producer|editor|representative|recruiter|accountant|counsel|attorney|nurse|teacher|technician|operator|planner|advisor|executive|partner|owner|chief [a-z ]+|staff|generalist|copywriter|illustrator|photographer|economist|statistician|support|assistant)$/i;
function plausibleTitle(value: string): string | null {
  const title = cleanTitle(value).replace(/\s*\((?:remote|hybrid|on-?site)[^)]*\)\s*$/i, '').replace(/\s+(?:role|position|opening|job)$/i, '');
  const words = title.split(/\s+/);
  if (words.length < 1 || words.length > 8 || title.length > 80) return null;
  if (!TITLE_NOUN.test(title)) return null;
  return title;
}

const TITLE_PATTERNS = [
  /\b(?:for|to) the ([A-Za-z][\w/&,+ .-]{2,80}?) (?:position|role|opening|job)\b/gi,
  /\bapplication (?:for|to) (?:the )?([A-Za-z][\w/&,+ .-]{2,80}?)(?: position| role)?(?: at | with |[.,!\n]|$)/gi,
  /\b(?:the|our|this) ([A-Za-z][\w/&,+ .-]{2,60}?) (?:role|position|opening)\b/gi,
  /\binterest in (?:the )?([A-Za-z][\w/&,+ .-]{2,80}?) (?:position|role|opening)\b/gi,
  /\bapplied (?:for|to) (?:the )?([A-Za-z][\w/&,+ .-]{2,80}?)(?: position| role)? at\b/gi,
  /\bas (?:a|an|our) ([A-Za-z][\w/&,+ .-]{2,60}?)(?: at | with |[.,!\n]|$)/gi,
];
const SUBJECT_TITLE = /(?:^|:\s*|[-–|]\s*)([A-Za-z][\w/&+ .-]{2,80}?)\s+(?:at|with|@|[-–|,])\s+([A-Z][\w&.' -]{1,60})\s*$/;

/** Role titles named in a message, longest first, deduplicated by normalized form. */
export function extractRoleTitles(subject: string, text: string): string[] {
  const titles = new Map<string, string>();
  const add = (value: string) => {
    const title = plausibleTitle(value);
    if (title) titles.set(normalizePhrase(title), title);
  };
  const subjectMatch = SUBJECT_TITLE.exec(subject.replace(/^(?:re|fwd?|fw):\s*/i, ''));
  if (subjectMatch) add(subjectMatch[1]);
  for (const source of [subject, text.slice(0, 6000)])
    for (const pattern of TITLE_PATTERNS)
      for (const match of source.matchAll(pattern)) {
        add(match[1]);
        if (titles.size > 6) break;
      }
  return [...titles.values()].sort((a, b) => b.length - a.length).slice(0, 6);
}

const COMPANY_PATTERNS = [
  /\b(?:applying|applied|application) (?:to|at|with) ([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,3})/g,
  /\binterest in (?:joining |working at )?([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,3})/g,
  /\b(?:position|role|opening) (?:at|with) ([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,3})/g,
  /\b(?:the|our) ([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,2}) (?:team|recruiting team|hiring team|talent team)\b/g,
];
const NOT_COMPANY = /^(?:the|our|your|this|a|an|we|you|i|us|team|recruiting|talent|hiring|careers?|jobs?|hr|people|thank|thanks|hello|hi|dear|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
/** Company names a message states, in order of appearance. */
export function extractCompanies(subject: string, text: string, fromName?: string | null): string[] {
  const names = new Map<string, string>();
  const add = (value: string) => {
    const name = value.replace(/[.,'’]+$/, '').replace(/\s+(?:Inc|LLC|Ltd|Corp)\.?$/i, '').trim();
    if (!name || name.length > 60 || NOT_COMPANY.test(name) || NOT_COMPANY.test(name.split(' ')[0])) return;
    names.set(name.toLowerCase(), name);
  };
  const subjectMatch = SUBJECT_TITLE.exec(subject.replace(/^(?:re|fwd?|fw):\s*/i, ''));
  if (subjectMatch) add(subjectMatch[2]);
  for (const source of [subject, text.slice(0, 6000)])
    for (const pattern of COMPANY_PATTERNS) for (const match of source.matchAll(pattern)) add(match[1]);
  // A sender name names the company only when it is a team mailbox, such as "Lumen Recruiting" or "Cedar via Greenhouse".
  const team = /\b(?:recruiting|talent(?: acquisition)?|hiring(?: team)?|careers|jobs|people team|hr)\b|\s(?:via|through)\s/i;
  if (fromName && team.test(fromName)) {
    const display = fromName.replace(/\s+(?:via|through)\s+.+$/i, '').replace(/\b(?:recruiting|talent(?: acquisition)?|hiring(?: team)?|careers|jobs|people team|team|hr)\b/gi, '').replace(/\s+/g, ' ').trim();
    if (display && /^[A-Z]/.test(display) && display.split(' ').length <= 3) add(display);
  }
  return [...names.values()].slice(0, 5);
}

export interface Signals {
  roleTitles: string[];
  companies: string[];
  requisitionIds: string[];
  urls: string[];
}
export function extractSignals(facts: MessageFacts): Signals {
  return {
    roleTitles: extractRoleTitles(facts.subject, facts.text),
    companies: extractCompanies(facts.subject, facts.text, facts.fromName),
    requisitionIds: extractRequisitionIds(`${facts.subject}\n${facts.text}`),
    urls: extractUrls(facts.text).slice(0, 40),
  };
}

// ─── Explicit times ─────────────────────────────────────────────────────────

const ZONE_ABBREVIATIONS: Record<string, string> = {
  EDT: 'America/New_York', EST: 'America/New_York', ET: 'America/New_York', 'EASTERN TIME': 'America/New_York', EASTERN: 'America/New_York',
  CDT: 'America/Chicago', CST: 'America/Chicago', CT: 'America/Chicago', 'CENTRAL TIME': 'America/Chicago', CENTRAL: 'America/Chicago',
  MDT: 'America/Denver', MST: 'America/Denver', MT: 'America/Denver', 'MOUNTAIN TIME': 'America/Denver', MOUNTAIN: 'America/Denver',
  PDT: 'America/Los_Angeles', PST: 'America/Los_Angeles', PT: 'America/Los_Angeles', 'PACIFIC TIME': 'America/Los_Angeles', PACIFIC: 'America/Los_Angeles',
  UTC: 'UTC', GMT: 'UTC',
};
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const TIME_PATTERN = new RegExp(
  `(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\\s+)?${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?,?\\s+(?:at|from|@)?\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?\\s*(?:\\(?\\s*(EDT|EST|ET|CDT|CST|CT|MDT|MST|MT|PDT|PST|PT|UTC|GMT|(?:eastern|central|mountain|pacific)(?: time)?)\\s*\\)?)`,
  'i',
);

export interface StatedTime {
  /** Wall-clock local time as written, such as 2026-10-16T10:00. */
  local: string;
  zone: string;
  passage: string;
}
/**
 * An interview time stated with its zone, such as "Friday, October 16 at
 * 10:00 MDT". A time without a zone is not guessed. The year is the next
 * occurrence on or after the message date when not written.
 */
export function parseStatedTime(text: string, receivedAt: string): StatedTime | null {
  const match = TIME_PATTERN.exec(text);
  if (!match) return null;
  const [whole, monthName, dayText, yearText, hourText, minuteText, meridiem, zoneText] = match;
  const month = MONTHS.findIndex((name) => name.startsWith(monthName.toLowerCase().slice(0, 3))) + 1;
  const day = Number(dayText);
  let hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (!month || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const mer = meridiem?.toLowerCase().replace(/\./g, '');
  if (mer === 'pm' && hour < 12) hour += 12;
  if (mer === 'am' && hour === 12) hour = 0;
  if (!mer && !minuteText) return null;
  const zone = ZONE_ABBREVIATIONS[zoneText.toUpperCase().replace(/\s+/g, ' ')];
  if (!zone) return null;
  const received = new Date(receivedAt);
  let year = yearText ? Number(yearText) : received.getUTCFullYear();
  if (!yearText) {
    const candidate = Date.UTC(year, month - 1, day);
    if (candidate < received.getTime() - 864e5 * 2) year += 1;
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return { local: `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`, zone, passage: whole.trim() };
}

/** Meeting links in text: Zoom, Google Meet, Teams, Webex and similar. */
export function meetingLinkIn(text: string): string | null {
  return extractUrls(text).find((url) => /(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|around\.co|meet\.jit\.si|chime\.aws)/i.test(url)) ?? null;
}
