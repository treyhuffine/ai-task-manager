/**
 * Which opportunity a message or calendar event belongs to, with the evidence
 * for each candidate. Identity comes from the thread, replies, invitation IDs,
 * requisition IDs, posting links, explicit role titles and known contacts. A
 * company domain or name alone never picks one of several roles: that case is
 * ambiguous and goes to review with every candidate and its evidence.
 */
import type { EvidenceItem, MatchLevel } from './model.js';
import { isPersonalMailDomain } from '@ri/app-kit/sources';
import { companyKey, domainLabel, isServiceDomain, normalizePhrase, phraseSpans, roleKey, urlKey } from './text.js';

export interface OpportunityIdentity {
  id: string;
  company: string;
  role: string;
  /** Employer mail domains learned from linked correspondence or entered contacts. */
  domains: string[];
  /** Normalized contact addresses linked to this opportunity. */
  contacts: string[];
  requisitionId: string | null;
  sourceUrl: string | null;
  archived: boolean;
}

export interface MatchSubject {
  subject: string;
  text: string;
  fromName?: string | null;
  /** Sender and other participants, normalized, excluding the owner's own address. */
  addresses: string[];
  urls: string[];
  requisitionIds: string[];
  roleTitles: string[];
  /** Opportunities already linked to this thread, reply chain or invitation. */
  linkedByThread: string[];
  linkedByReply: string[];
  linkedByInvite: string[];
}

export type CandidateLevel = 'exact' | 'strong' | 'probable' | 'weak';
export interface MatchCandidate {
  opportunityId: string;
  level: CandidateLevel;
  evidence: EvidenceItem[];
}
export interface MatchResult {
  level: MatchLevel;
  opportunityId: string | null;
  candidates: MatchCandidate[];
  /** Plain explanation of the decision. */
  reason: string;
  /** The message names two or more of the user's roles. */
  multiRole: boolean;
  /** A role title the message names that matches no candidate. */
  otherRole: string | null;
}

const DOMAIN_SUFFIXES = ['', 'hq', 'app', 'inc', 'co', 'labs', 'team', 'jobs', 'careers', 'corp', 'group', 'mail'];
/** A domain belongs to a company when it is a learned domain or its label is the company name. */
export function domainMatchesCompany(domain: string, identity: Pick<OpportunityIdentity, 'company' | 'domains'>): boolean {
  const value = domain.toLowerCase();
  if (identity.domains.some((known) => value === known || value.endsWith(`.${known}`))) return true;
  if (isServiceDomain(value) || isPersonalMailDomain(value)) return false;
  const label = domainLabel(value);
  const key = companyKey(identity.company);
  if (!label || key.length < 3) return false;
  return DOMAIN_SUFFIXES.some((suffix) => label === key + suffix);
}

const EXACT_KINDS = new Set(['thread', 'reply', 'invite', 'requisition', 'posting_url']);

/** Role spans that are not part of a longer role title another candidate owns. */
function roleMentioned(text: string, role: string, longerRoles: string[]): boolean {
  const spans = phraseSpans(text, role);
  if (!spans.length) return false;
  const longer = longerRoles.flatMap((other) => phraseSpans(text, other));
  return spans.some(([start, end]) => !longer.some(([s, e]) => s <= start && e >= end));
}

function titlesCover(title: string, role: string): boolean {
  const a = normalizePhrase(title), b = roleKey(role);
  return a === b || phraseSpans(a, b).length > 0 || phraseSpans(b, a).length > 0;
}

export function matchOpportunity(subject: MatchSubject, opportunities: OpportunityIdentity[]): MatchResult {
  const text = normalizePhrase(`${subject.subject}\n${subject.text.slice(0, 20000)}`);
  const display = normalizePhrase(subject.fromName ?? '');
  const domains = [...new Set(subject.addresses.map((address) => address.slice(address.lastIndexOf('@') + 1).toLowerCase()).filter(Boolean))];
  const urls = new Set(subject.urls.map(urlKey).filter((value): value is string => !!value));
  const requisitions = new Set(subject.requisitionIds.map((value) => value.toUpperCase()));
  const roleKeys = opportunities.map((item) => roleKey(item.role));
  const contactOwners = new Map<string, number>();
  for (const item of opportunities) for (const contact of new Set(item.contacts)) contactOwners.set(contact, (contactOwners.get(contact) ?? 0) + 1);

  const candidates: MatchCandidate[] = [];
  for (const item of opportunities) {
    const evidence: EvidenceItem[] = [];
    if (subject.linkedByThread.includes(item.id)) evidence.push({ kind: 'thread', detail: 'Same email thread as a message already linked to this role' });
    if (subject.linkedByReply.includes(item.id)) evidence.push({ kind: 'reply', detail: 'Replies to a message already linked to this role' });
    if (subject.linkedByInvite.includes(item.id)) evidence.push({ kind: 'invite', detail: 'Same calendar invitation as this role’s interview' });
    if (item.requisitionId && requisitions.has(item.requisitionId.toUpperCase())) evidence.push({ kind: 'requisition', detail: `Requisition ${item.requisitionId}` });
    const posting = urlKey(item.sourceUrl);
    if (posting && urls.has(posting)) evidence.push({ kind: 'posting_url', detail: 'Links to the saved posting' });
    const key = roleKey(item.role);
    const longer = roleKeys.filter((other) => other !== key && other.length > key.length && phraseSpans(other, key).length > 0);
    const role = roleMentioned(text, key, longer);
    if (role) evidence.push({ kind: 'role_title', detail: `Names the role “${item.role}”` });
    const contacts = subject.addresses.filter((address) => item.contacts.includes(address));
    for (const contact of contacts.slice(0, 2)) evidence.push({ kind: 'contact', detail: (contactOwners.get(contact) ?? 0) > 1 ? `${contact} is linked to more than one of your roles` : `${contact} wrote about this role before` });
    const domain = domains.find((value) => domainMatchesCompany(value, item));
    if (domain) evidence.push({ kind: 'company_domain', detail: `Company domain ${domain}` });
    const company = normalizePhrase(item.company);
    if (company.length >= 3 && (phraseSpans(text, company).length || phraseSpans(display, company).length)) evidence.push({ kind: 'company_name', detail: `Names ${item.company}` });
    if (!evidence.length) continue;

    const exact = evidence.some((entry) => EXACT_KINDS.has(entry.kind));
    const companyEvidence = !!domain || evidence.some((entry) => entry.kind === 'company_name');
    const uniqueContact = contacts.some((contact) => (contactOwners.get(contact) ?? 0) === 1);
    let level: CandidateLevel;
    if (exact) level = 'exact';
    else if (role && (companyEvidence || contacts.length)) level = 'strong';
    else if (uniqueContact) level = 'probable';
    else if (companyEvidence || contacts.length) level = 'weak';
    else continue; // A role title alone, from an unrelated company, is not evidence for this role.
    if (item.archived && level !== 'exact') continue;
    candidates.push({ opportunityId: item.id, level, evidence });
  }

  const rank: Record<CandidateLevel, number> = { exact: 0, strong: 1, probable: 2, weak: 3 };
  candidates.sort((a, b) => rank[a.level] - rank[b.level]);
  const named = candidates.filter((candidate) => candidate.evidence.some((entry) => entry.kind === 'role_title'));
  const multiRole = named.length > 1;
  const byId = new Map(opportunities.map((item) => [item.id, item]));
  const otherRole = subject.roleTitles.find((title) => !candidates.some((candidate) => titlesCover(title, byId.get(candidate.opportunityId)!.role))) ?? null;
  const result = (level: MatchLevel, opportunityId: string | null, reason: string): MatchResult => ({ level, opportunityId, candidates, reason, multiRole, otherRole });

  if (!candidates.length) return result('none', null, otherRole ? `Names ${otherRole}, which is not one of your saved roles` : 'No saved role matches');
  const exacts = candidates.filter((candidate) => candidate.level === 'exact');
  if (exacts.length > 1) return result('ambiguous', null, 'This thread is already linked to more than one role');
  if (exacts.length === 1) {
    const others = named.filter((candidate) => candidate.opportunityId !== exacts[0].opportunityId);
    if (others.length) return result('ambiguous', null, 'The thread belongs to one role but this message names another');
    return result('exact', exacts[0].opportunityId, exacts[0].evidence.find((entry) => EXACT_KINDS.has(entry.kind))!.detail);
  }
  const strongs = candidates.filter((candidate) => candidate.level === 'strong');
  if (strongs.length > 1) return result('ambiguous', null, 'The message names more than one of your roles');
  if (strongs.length === 1) return result('strong', strongs[0].opportunityId, 'Names the role and the company');
  if (otherRole) return result('none', null, `Names ${otherRole}, which is not one of your saved roles`);
  const probables = candidates.filter((candidate) => candidate.level === 'probable');
  if (probables.length > 1) return result('ambiguous', null, 'A contact here writes about more than one of your roles');
  if (probables.length === 1 && candidates.length === 1) return result('probable', probables[0].opportunityId, 'From a contact linked only to this role');
  if (probables.length === 1) return result('ambiguous', null, 'A known contact points to one role but the company has other roles');
  if (candidates.length === 1) {
    const only = byId.get(candidates[0].opportunityId)!;
    const sameCompany = opportunities.filter((item) => !item.archived && companyKey(item.company) === companyKey(only.company));
    if (sameCompany.length === 1) {
      candidates[0].evidence.push({ kind: 'company_name', detail: `Your only saved role at ${only.company}` });
      return result('probable', only.id, `Your only saved role at ${only.company}`);
    }
  }
  return result('ambiguous', null, 'The company matches more than one of your roles, and the message does not say which');
}
