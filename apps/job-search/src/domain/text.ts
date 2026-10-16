/**
 * Text identity helpers shared by matching, postings and the view. Everything
 * here is pure: no storage, no clock and no network.
 */

/** Lower case, accents removed, every run of non letters or digits collapsed to one space. */
export function normalizePhrase(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Letters and digits only, for company names and domain labels. */
export function compactKey(value: string): string {
  return normalizePhrase(value).replace(/ /g, '');
}

const COMPANY_SUFFIX = / (inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|sa|ag|bv|pty)$/;
/** A comparable company key. "Northstar, Inc." and "northstar" share one key. */
export function companyKey(company: string): string {
  let phrase = normalizePhrase(company);
  while (COMPANY_SUFFIX.test(phrase)) phrase = phrase.replace(COMPANY_SUFFIX, '');
  return phrase.replace(/ /g, '');
}

/** A comparable role key: normalized words, so punctuation and case never split a role. */
export function roleKey(role: string): string {
  return normalizePhrase(role);
}

/**
 * Word-boundary occurrences of a normalized phrase inside normalized text, as
 * [start, end) offsets. Both arguments must already be normalized.
 */
export function phraseSpans(text: string, phrase: string): [number, number][] {
  if (!phrase) return [];
  const haystack = ` ${text} `;
  const needle = ` ${phrase} `;
  const spans: [number, number][] = [];
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    spans.push([index, index + phrase.length]);
    from = index + 1;
    if (spans.length > 50) break;
  }
  return spans;
}

const TWO_PART_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'com.mx', 'co.in', 'com.sg', 'co.za', 'com.tr', 'com.cn', 'co.kr']);
/** The registrable label of a domain: "careers.northstar.com" gives "northstar". */
export function domainLabel(domain: string): string | null {
  const parts = domain.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (parts.length < 2) return parts[0] ?? null;
  const lastTwo = parts.slice(-2).join('.');
  const label = TWO_PART_SUFFIXES.has(lastTwo) && parts.length >= 3 ? parts[parts.length - 3] : parts[parts.length - 2];
  return label || null;
}

/** Applicant tracking and scheduling services. Their domains never identify the employer. */
const SERVICE_DOMAINS = [
  'greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'hire.lever.co', 'ashbyhq.com', 'ashbyhq.io', 'myworkday.com', 'myworkdayjobs.com', 'workday.com',
  'smartrecruiters.com', 'icims.com', 'jobvite.com', 'bamboohr.com', 'workable.com', 'workablemail.com', 'recruitee.com', 'breezy.hr', 'teamtailor.com',
  'teamtailor-mail.com', 'successfactors.com', 'taleo.net', 'jazzhr.com', 'applytojob.com', 'rippling.com', 'gem.com', 'goodtime.io', 'calendly.com',
  'linkedin.com', 'indeed.com', 'indeedemail.com', 'glassdoor.com', 'wellfound.com', 'angel.co', 'ziprecruiter.com', 'hired.com', 'otta.com',
  'welcometothejungle.com', 'dice.com', 'monster.com', 'google.com', 'zoom.us', 'microsoft.com', 'outlook.com', 'example.test',
];
export function isServiceDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const value = domain.toLowerCase();
  return SERVICE_DOMAINS.some((service) => value === service || value.endsWith(`.${service}`));
}

/** Links in text, without trailing punctuation. */
export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'()[\]{}]+/gi) ?? [];
  return [...new Set(found.map((url) => url.replace(/[.,;:!?]+$/, '')))].slice(0, 100);
}

/** A comparable form of a posting link: host without www, path without trailing slash, no query or fragment. */
export function urlKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${host}${pathname}`.toLowerCase();
  } catch {
    return null;
  }
}

/** A user-supplied link kept only when it is an ordinary web address. */
export function cleanUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const value = url.trim();
  if (!value) return null;
  try {
    const parsed = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.href.slice(0, 2000);
  } catch {
    return null;
  }
}

/** Requisition and job IDs such as "Req ID: R-4821" or "Job #10442". Uppercased without spaces. */
export function extractRequisitionIds(text: string): string[] {
  const ids = new Set<string>();
  const pattern = /\b(?:req(?:uisition)?|job|posting|position)\s*(?:id|#|no\.?|number|code)?\s*[:#]?\s*\(?([A-Z]{0,4}[-_]?\d{3,10}(?:[-_]\d{1,4})?)\)?/gi;
  for (const match of text.matchAll(pattern)) {
    const value = match[1].toUpperCase().replace(/_/g, '-');
    if (/\d{3,}/.test(value)) ids.add(value);
    if (ids.size >= 10) break;
  }
  return [...ids];
}
export function requisitionKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.toUpperCase().replace(/\s+/g, '').replace(/_/g, '-');
  return /\d{3,}/.test(key) ? key : null;
}

/** Collapse whitespace and cut at a word boundary for display evidence. */
export function excerpt(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The sentence or line around the first occurrence of a pattern, as exact source text. */
export function passageAround(text: string, index: number, max = 280): string {
  if (index < 0) return '';
  let start = index, end = index;
  while (start > 0 && !/[\n.!?]/.test(text[start - 1]) && index - start < max / 2) start--;
  while (end < text.length && !/[\n]/.test(text[end]) && end - index < max / 2) {
    end++;
    if (/[.!?]/.test(text[end - 1]) && end - index > 12) break;
  }
  return text.slice(start, end).trim();
}

/** Strip a leading article and surrounding punctuation from a captured title. */
export function cleanTitle(value: string): string {
  let text = value
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’\[:,-]+|[\s"'“”‘’\]:,.-]+$/g, '')
    .replace(/^(the|a|an|our|your)\s+/i, '')
    .trim();
  // Keep balanced parentheses, such as "Denver, CO (Hybrid)", and drop stray ones.
  const count = (char: string) => text.split(char).length - 1;
  while (text.endsWith(')') && count(')') > count('(')) text = text.slice(0, -1).trim();
  while (text.startsWith('(') && count('(') > count(')')) text = text.slice(1).trim();
  return text;
}

/** Title case only the first letter, keeping acronyms. */
export function sentenceCase(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
