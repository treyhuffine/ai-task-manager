/**
 * Employer contacts and company domains on an opportunity. Each one keeps the
 * source it came from: `manual` for what the person entered, or the account
 * whose correspondence taught it. A reader sees only contacts from sources it
 * may see, and matching mail or events from one account uses only what the
 * person entered and what that same account taught. One address learned from
 * two accounts is stored once per account, so either account alone shows it.
 */
import { allows, type AccessScope } from '@ri/app-kit/data';
import { emailDomain, isPersonalMailDomain, normalizeEmail } from '@ri/app-kit/sources';
import { isServiceDomain } from '../domain/text.js';
import { MANUAL_SOURCE } from '../domain/model.js';
import { json, type Row } from './util.js';

export interface StoredContact {
  email: string;
  name: string | null;
  /** Older entries may lack it. They are the owner's alone. */
  source?: string;
}
export interface StoredDomain {
  domain: string;
  source: string;
}

/** A source no caller's scope can name, for entries stored before sources were recorded. */
const OWNER_ONLY = 'owner:unrecorded';
const MAX_CONTACTS = 50;
const MAX_DOMAINS = 40;

const sourceOf = (contact: StoredContact) => contact.source ?? OWNER_ONLY;
export const contactsOf = (row: Row): StoredContact[] => json<StoredContact[]>(row.contacts, []);

/** An address's domain when it can identify an employer: not personal mail and not an applicant tracking service. */
export function employerDomain(address: string): string | null {
  const domain = emailDomain(address);
  return domain && !isServiceDomain(domain) && !isPersonalMailDomain(domain) ? domain : null;
}

/**
 * The opportunity's domains with their sources. Rows written before sources were
 * recorded hold bare domains: each takes the source of a contact at that domain,
 * the person's own first, and a domain no contact explains is the owner's alone.
 */
export function domainsOf(row: Row, contacts = contactsOf(row)): StoredDomain[] {
  const out: StoredDomain[] = [];
  const add = (entry: StoredDomain) => {
    if (!out.some((item) => item.domain === entry.domain && item.source === entry.source)) out.push(entry);
  };
  for (const entry of json<(string | StoredDomain)[]>(row.company_domains, [])) {
    if (typeof entry !== 'string') {
      if (entry?.domain && entry.source) add({ domain: entry.domain, source: entry.source });
      continue;
    }
    const holders = contacts.filter((contact) => employerDomain(contact.email) === entry);
    const holder = holders.find((contact) => contact.source === MANUAL_SOURCE) ?? holders[0];
    add({ domain: entry, source: holder ? sourceOf(holder) : OWNER_ONLY });
  }
  return out.slice(0, MAX_DOMAINS);
}

/** The contacts this reader may see, one per address. */
export function visibleContacts(row: Row, scope: AccessScope): { email: string; name: string | null }[] {
  const out: { email: string; name: string | null }[] = [];
  for (const contact of contactsOf(row)) {
    if (!allows(scope, sourceOf(contact)) || out.some((item) => item.email === contact.email)) continue;
    out.push({ email: contact.email, name: contact.name ?? null });
  }
  return out;
}

/** Addresses and domains that may serve as matching evidence for an item from these sources. */
export function matchingIdentity(row: Row, sources: ReadonlySet<string>): { contacts: string[]; domains: string[] } {
  const contacts = contactsOf(row);
  return {
    contacts: [...new Set(contacts.filter((contact) => sources.has(sourceOf(contact))).map((contact) => contact.email))],
    domains: [...new Set(domainsOf(row, contacts).filter((entry) => sources.has(entry.source)).map((entry) => entry.domain))],
  };
}
/** The person's own entries plus what this one source taught. */
export const matchingSources = (sourceKey: string): ReadonlySet<string> => new Set([MANUAL_SOURCE, sourceKey]);

/** The contacts and domains for a new opportunity, all entered by the person. */
export function initialContacts(entered: { email: string; name: string | null }[]): { contacts: StoredContact[]; domains: StoredDomain[] } {
  const contacts: StoredContact[] = [];
  for (const item of entered) {
    const email = normalizeEmail(item.email);
    if (!contacts.some((contact) => contact.email === email)) contacts.push({ email, name: item.name, source: MANUAL_SOURCE });
  }
  const domains: StoredDomain[] = [];
  for (const contact of contacts) {
    const domain = employerDomain(contact.email);
    if (domain && !domains.some((item) => item.domain === domain)) domains.push({ domain, source: MANUAL_SOURCE });
  }
  return { contacts: contacts.slice(0, MAX_CONTACTS), domains: domains.slice(0, MAX_DOMAINS) };
}

/**
 * Replace the contacts this writer can see with the list it sent. Contacts it
 * cannot see stay untouched. A contact it kept keeps its source, so deleting
 * that account's data still removes it. A new address is the writer's own entry.
 * Domains are only ever added here, as before, so matching keeps what it learned.
 */
export function editedContacts(row: Row, entered: { email: string; name: string | null }[], scope: AccessScope): { contacts: StoredContact[]; domains: StoredDomain[] } {
  const typed = new Map<string, string | null>();
  for (const item of entered) typed.set(normalizeEmail(item.email), item.name);
  const existing = contactsOf(row);
  const contacts: StoredContact[] = [];
  for (const contact of existing) {
    if (!allows(scope, sourceOf(contact))) contacts.push(contact);
    else if (typed.has(contact.email)) contacts.push({ ...contact, name: typed.get(contact.email) ?? null });
  }
  const added: StoredContact[] = [];
  for (const [email, name] of typed) {
    if (!contacts.some((contact) => contact.email === email && allows(scope, sourceOf(contact)))) added.push({ email, name, source: MANUAL_SOURCE });
  }
  const next = [...contacts, ...added].slice(0, MAX_CONTACTS);
  const domains = domainsOf(row, existing);
  for (const contact of added) {
    const domain = employerDomain(contact.email);
    if (domain && !domains.some((item) => item.domain === domain && item.source === MANUAL_SOURCE)) domains.push({ domain, source: MANUAL_SOURCE });
  }
  return { contacts: next, domains: domains.slice(0, MAX_DOMAINS) };
}

/** Remember the other party of linked correspondence, keyed to the account it came from. Returns null when nothing changed. */
export function learnedContact(row: Row, address: string, name: string | null | undefined, source: string): { contacts: StoredContact[]; domains: StoredDomain[] } | null {
  const email = normalizeEmail(address);
  const contacts = contactsOf(row);
  const domains = domainsOf(row, contacts);
  let changed = false;
  if (!contacts.some((contact) => contact.email === email && contact.source === source) && contacts.length < MAX_CONTACTS) {
    contacts.push({ email, name: name?.slice(0, 200) ?? null, source });
    changed = true;
  }
  const domain = employerDomain(email);
  if (domain && !domains.some((item) => item.domain === domain && item.source === source) && domains.length < MAX_DOMAINS) {
    domains.push({ domain, source });
    changed = true;
  }
  return changed ? { contacts, domains } : null;
}

/** Everything one source taught, removed. Null when the opportunity held nothing from it. */
export function withoutSource(row: Row, source: string): { contacts: StoredContact[]; domains: StoredDomain[] } | null {
  const contacts = contactsOf(row);
  const domains = domainsOf(row, contacts);
  const keptContacts = contacts.filter((contact) => contact.source !== source);
  const keptDomains = domains.filter((entry) => entry.source !== source);
  if (keptContacts.length === contacts.length && keptDomains.length === domains.length) return null;
  return { contacts: keptContacts, domains: keptDomains };
}
