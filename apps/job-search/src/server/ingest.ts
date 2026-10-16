/**
 * Applying mail and calendar evidence to opportunities, following the stage
 * and communication rules:
 *
 * - An exact acknowledgment moves a Saved role to Applied when identity is
 *   unambiguous and no correction of the user's disagrees. Weaker matches
 *   only suggest it.
 * - An invitation to choose times is "Scheduling needed", never a scheduled
 *   interview.
 * - A confirmed time (calendar event, invitation file or stated time with
 *   zone) creates or updates the interview, keeping participants and zone.
 * - A reschedule or cancellation updates that same interview and keeps its
 *   history. A canceled meeting never closes the application.
 * - Offers and rejections change the stage only on strong matches. Anything
 *   ambiguous or naming two roles goes to review with every candidate.
 * - Silence never changes anything.
 *
 * Every function runs inside the caller's transaction.
 */
import { accountSource, newId } from '@ri/app-kit/data';
import { isNoReply, normalizeEmail, occurrenceKey, withoutQuotedReply, type CalendarEvent, type MailMessage } from '@ri/app-kit/sources';
import { instantFromLocal, isValidZone } from '@ri/app-kit/time';
import { classifyMessage, extractSignals, looksJobRelated, meetingLinkIn, parseStatedTime } from '../domain/classify.js';
import { matchOpportunity, type MatchResult, type OpportunityIdentity } from '../domain/match.js';
import { CLASSIFICATION_LABELS, STAGE_ORDER, stageLabel, type Classification, type EvidenceItem, type Interview, type MatchLevel, type Outcome, type Stage } from '../domain/model.js';
import { excerpt, extractRequisitionIds, extractUrls, domainLabel, isServiceDomain, sentenceCase } from '../domain/text.js';
import { extractRoleTitles } from '../domain/classify.js';
import { app, bumpRevision, nowAt } from './state.js';
import { changeStageFor, getOpportunityRow, insertStageEvent, currentStage } from './opportunities.js';
import { linkCorrespondence, replyOpportunities, setMatchState, threadIgnored, threadOpportunities } from './correspondence.js';
import { applySourceUpdate, insertInterview, markSourceRemoved, sourceValuesOf, type InterviewValues } from './interviews.js';
import { groupIgnored, upsertReview } from './review.js';
import { json, num, opt, str, type Row } from './util.js';

export const EXTRACTION_VERSION = 1;
export const AUTOMATIC = 'automatic';

export function opportunityIdentities(): OpportunityIdentity[] {
  return app().db.prepare('SELECT id, company, role, company_domains, contacts, requisition_id, source_url, archived_at FROM opportunities ORDER BY created_at LIMIT 5000').all().map((row) => ({
    id: str(row.id),
    company: str(row.company),
    role: str(row.role),
    domains: json<string[]>(row.company_domains, []),
    contacts: json<{ email: string }[]>(row.contacts, []).map((contact) => contact.email),
    requisitionId: opt(row.requisition_id),
    sourceUrl: opt(row.source_url),
    archived: !!row.archived_at,
  }));
}

const STAGE_FOR: Partial<Record<Classification, { stage: Stage; outcome: Outcome | null }>> = {
  acknowledgment: { stage: 'applied', outcome: null },
  sent_application: { stage: 'applied', outcome: null },
  interview_confirmed: { stage: 'interviewing', outcome: null },
  offer: { stage: 'offer', outcome: null },
  rejection: { stage: 'closed', outcome: 'rejected' },
};
const APPLICATION_KINDS = new Set<Classification>(['acknowledgment', 'sent_application', 'scheduling', 'interview_confirmed', 'reschedule', 'offer', 'rejection']);

/** Propose a stage for the user to accept, without changing anything. */
export function suggestStage(opportunityId: string, target: { stage: Stage; outcome: Outcome | null }, details: { source: string; confidence: 'probable' | 'strong' | 'exact' | 'ai'; evidence: { kind: 'correspondence' | 'interview'; id: string }; reason: string; dedupeKey: string; at?: string }) {
  const row = getOpportunityRow(opportunityId);
  if (!row) return;
  const current = currentStage(row);
  if (current.stage === target.stage && current.outcome === target.outcome) return;
  if (target.stage !== 'closed' && STAGE_ORDER[target.stage] < STAGE_ORDER[current.stage]) return;
  if (current.stage === 'closed') return;
  const eventId = insertStageEvent({ opportunityId, from: current, to: target, at: details.at ?? nowAt(), author: AUTOMATIC, source: details.source, confidence: details.confidence, decision: 'suggested', revision: num(row.revision), evidence: details.evidence, note: details.reason, dedupeKey: details.dedupeKey });
  if (!eventId) return;
  upsertReview({
    kind: 'stage',
    groupKey: `stage:${opportunityId}`,
    sourceKey: details.source,
    title: `${str(row.company)} · ${str(row.role)}`,
    summary: `${details.reason} suggests ${stageLabel(target.stage, target.outcome)}. The stage stays ${stageLabel(current.stage, current.outcome)} until you decide.`,
    candidates: [{ opportunityId, level: details.confidence === 'ai' ? 'probable' : details.confidence, evidence: [] }],
    evidenceIds: details.evidence.kind === 'correspondence' ? [details.evidence.id] : [],
    proposal: { stage: target.stage, outcome: target.outcome, company: null, role: null, classification: null, interviewId: details.evidence.kind === 'interview' ? details.evidence.id : null },
    opportunityId,
  });
}

/** Change the stage automatically on exact or strong evidence, suggest it on weaker evidence. */
function stageFromEvidence(opportunityId: string, target: { stage: Stage; outcome: Outcome | null }, level: MatchLevel, details: { source: string; evidence: { kind: 'correspondence' | 'interview'; id: string }; reason: string; dedupeKey: string; at?: string }) {
  if (level === 'exact' || level === 'strong') {
    changeStageFor({ opportunityId, target, kind: 'automatic', author: AUTOMATIC, source: details.source, confidence: level, at: details.at, evidence: details.evidence, note: details.reason, dedupeKey: details.dedupeKey, reason: details.reason });
  } else if (level === 'probable') {
    suggestStage(opportunityId, target, { ...details, confidence: 'probable' });
  }
}

// ─── Interview values ────────────────────────────────────────────────────────

/** An instant and its zone from an invitation time such as 2026-10-16T10:00:00[America/Denver]. Floating times are not guessed. */
export function inviteInstant(value: string | null): { at: string; zone: string | null } | null {
  if (!value) return null;
  const zoned = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2})?\[([^\]]+)\]$/.exec(value);
  if (zoned) {
    if (!isValidZone(zoned[2])) return null;
    return { at: instantFromLocal(zoned[1], zoned[2]).instant, zone: zoned[2] };
  }
  if (/Z$/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? { at: new Date(parsed).toISOString(), zone: 'UTC' } : null;
  }
  return null;
}

function formatFrom(text: string, joinUrl: string | null, location: string | null): Interview['format'] {
  if (joinUrl) return 'video';
  if (/\b(phone|call you|dial|by phone|phone screen)\b/i.test(text)) return 'phone';
  if (location && !/https?:\/\//i.test(location) && /\d|,/.test(location)) return 'onsite';
  if (/\b(on[- ]?site|in person|our office)\b/i.test(text)) return 'onsite';
  return 'unknown';
}

// ─── Mail ────────────────────────────────────────────────────────────────────

export interface MailContext {
  account: string;
  ownAddress: string | null;
}

export type IngestOutcome = 'kept' | 'skipped';

/** Store and apply one message. Repeated delivery of the same message changes nothing. */
export function ingestMessage(message: MailMessage, context: MailContext): IngestOutcome {
  const { db, blobs } = app();
  if (message.draft || message.discarded) return 'skipped';
  const sourceKey = accountSource(context.account);
  const existing = db.prepare('SELECT * FROM correspondence WHERE account = ? AND message_id = ?').get(context.account, message.id);
  if (existing) {
    // Same message again: never re-decide, and never undo a person's decision.
    if (str(existing.payload_digest) !== message.digest && !existing.unavailable_at) {
      const text = withoutQuotedReply(message.text);
      db.prepare('UPDATE correspondence SET subject = ?, evidence = ?, payload_digest = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(message.subject.slice(0, 500), excerpt(text, 600), message.digest, nowAt(), str(existing.id));
      bumpRevision();
    }
    return 'kept';
  }

  const text = withoutQuotedReply(message.text);
  const facts = { subject: message.subject, text, sent: message.sent, fromName: message.from?.name ?? null, invite: message.invite };
  const classified = classifyMessage(facts);
  const own = context.ownAddress ? normalizeEmail(context.ownAddress).toLowerCase() : null;
  const addresses = [message.from, ...message.to, ...message.cc].filter((item): item is NonNullable<typeof item> => !!item).map((item) => item.normalized).filter((address) => address.toLowerCase() !== own);
  const linkedByThread = threadOpportunities(context.account, message.threadId);
  const linkedByReply = replyOpportunities([message.inReplyTo ?? '', ...message.references]);
  const uid = message.invite?.uid ?? null;
  const linkedByInvite = uid ? db.prepare('SELECT DISTINCT opportunity_id FROM interviews WHERE ical_uid = ?').all(uid).map((row) => str(row.opportunity_id)) : [];
  const identities = opportunityIdentities();
  const knownContact = addresses.some((address) => identities.some((identity) => identity.contacts.includes(address)));
  const linked = linkedByThread.length + linkedByReply.length + linkedByInvite.length > 0;
  const signals = extractSignals(facts);
  const result = matchOpportunity({ subject: message.subject, text, fromName: message.from?.name ?? null, addresses, urls: signals.urls, requisitionIds: signals.requisitionIds, roleTitles: signals.roleTitles, linkedByThread, linkedByReply, linkedByInvite }, identities);
  // A message about a saved role is relevant even without job words. A company domain or name alone is not, so other mail from that company stays out.
  const aboutSavedRole = result.candidates.some((candidate) => candidate.evidence.some((entry) => entry.kind !== 'company_domain' && entry.kind !== 'company_name'));
  const jobRelated = classified.classification !== 'other' || looksJobRelated(message.subject, text.slice(0, 4000)) || linked || knownContact || aboutSavedRole;
  const bulk = message.bulkReasons.some((reason) => ['mailing list', 'unsubscribe link', 'promotions', 'social', 'forums'].includes(reason));
  if (!jobRelated || (bulk && !linked && (classified.classification === 'other' || classified.classification === 'recruiter'))) return 'skipped';

  const body = blobs.put(text.slice(0, 20000));
  const id = newId(), time = nowAt();
  db.prepare(`INSERT INTO correspondence (id, created_at, updated_at, revision, source_key, account, message_id, thread_id, rfc_message_id, in_reply_to, refs, subject, from_json, to_json, sent, received_at,
    evidence, body_digest, payload_digest, extraction_version, classification, classification_passage, signals, invite_uid, opportunity_id, match_status, match_level, match_basis, matched_by, review_id,
    ai_label, enrich_state, unavailable_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'unmatched', ?, '[]', NULL, NULL, NULL, ?, NULL)`).run(
    id, time, time, sourceKey, context.account, message.id, message.threadId, message.messageId, message.inReplyTo, JSON.stringify(message.references.slice(-20)), message.subject.slice(0, 500),
    message.from ? JSON.stringify(message.from) : null, JSON.stringify([...message.to, ...message.cc].slice(0, 30)), message.sent ? 1 : 0, message.receivedAt,
    excerpt(classified.passage ?? text, 600), body.digest, message.digest, EXTRACTION_VERSION, classified.classification, classified.passage?.slice(0, 600) ?? null, JSON.stringify(signals), uid,
    result.level, classified.classification === 'other' ? 'pending' : 'none',
  );
  bumpRevision();
  applyMailDecision(id, message, classified.classification, result, signals, context);
  return 'kept';
}

/** Link, review or leave a stored message, then apply its classification. Also used after AI enrichment and review decisions. */
export function applyMailDecision(correspondenceId: string, message: Pick<MailMessage, 'id' | 'threadId' | 'subject' | 'receivedAt' | 'messageId' | 'invite' | 'text' | 'from'>, classification: Classification, result: MatchResult, signals: { roleTitles: string[]; companies: string[] }, context: MailContext, options: { ai?: boolean } = {}) {
  const sourceKey = accountSource(context.account);
  const groupKey = `mail:${context.account}:${message.threadId}`;
  const thread = threadIgnored(context.account, message.threadId) || groupIgnored(groupKey);
  if (thread && result.level !== 'exact') {
    setMatchState(correspondenceId, 'ignored', { level: result.level, basis: [] });
    return;
  }
  const label = CLASSIFICATION_LABELS[classification];
  const proposedStage = STAGE_FOR[classification] ?? null;
  if (result.opportunityId && (result.level === 'exact' || result.level === 'strong' || result.level === 'probable')) {
    const candidate = result.candidates.find((item) => item.opportunityId === result.opportunityId)!;
    linkCorrespondence(correspondenceId, result.opportunityId, result.level, candidate.evidence, AUTOMATIC, context.ownAddress);
    applyClassification(result.opportunityId, correspondenceId, classification, options.ai ? 'probable' : result.level, message, context, sourceKey, options.ai ? `An AI reading of the email “${excerpt(message.subject, 80)}”` : `${label} email`);
    return;
  }
  if (result.level === 'ambiguous') {
    const reviewId = upsertReview({
      kind: 'match',
      groupKey,
      sourceKey,
      title: excerpt(message.subject || 'Email without a subject', 120),
      summary: result.multiRole ? `${label}. It names more than one of your roles. Choose which one it belongs to, or ignore it.` : `${label}. ${result.reason}. Choose the role it belongs to, or ignore it.`,
      candidates: result.candidates.map((candidate) => ({ opportunityId: candidate.opportunityId, level: candidate.level === 'weak' ? 'ambiguous' : candidate.level, evidence: candidate.evidence })),
      evidenceIds: [correspondenceId],
      proposal: { stage: proposedStage?.stage ?? null, outcome: proposedStage?.outcome ?? null, company: null, role: null, classification, interviewId: null },
      opportunityId: null,
    });
    setMatchState(correspondenceId, 'review', { reviewId, basis: [] });
    return;
  }
  const application = APPLICATION_KINDS.has(classification) || (classification === 'recruiter' && signals.roleTitles.length > 0);
  if (application) {
    const senderDomain = message.from?.normalized ? message.from.normalized.slice(message.from.normalized.lastIndexOf('@') + 1) : null;
    const company = signals.companies[0] ?? (senderDomain && !isServiceDomain(senderDomain) ? sentenceCase(domainLabel(senderDomain) ?? '') || null : null);
    const reviewId = upsertReview({
      kind: 'new_opportunity',
      groupKey,
      sourceKey,
      title: excerpt(message.subject || 'Email without a subject', 120),
      summary: `${label}${signals.roleTitles[0] ? ` for ${signals.roleTitles[0]}` : ''}${company ? ` at ${company}` : ''}. It does not match a saved role. Add it as an opportunity, attach it to one, or ignore it.`,
      candidates: result.candidates.map((candidate) => ({ opportunityId: candidate.opportunityId, level: 'ambiguous', evidence: candidate.evidence })),
      evidenceIds: [correspondenceId],
      proposal: { stage: proposedStage?.stage ?? (classification === 'scheduling' || classification === 'reschedule' ? 'interviewing' : null), outcome: proposedStage?.outcome ?? null, company, role: signals.roleTitles[0] ?? null, classification, interviewId: null },
      opportunityId: null,
    });
    setMatchState(correspondenceId, 'review', { reviewId, basis: [] });
    return;
  }
  setMatchState(correspondenceId, 'unmatched', { level: result.level, basis: [] });
}

/** Apply what a linked message says to its opportunity. */
export function applyClassification(opportunityId: string, correspondenceId: string, classification: Classification, level: MatchLevel, message: Pick<MailMessage, 'id' | 'threadId' | 'subject' | 'receivedAt' | 'messageId' | 'invite' | 'text'>, context: MailContext, sourceKey: string, reason: string) {
  const { db } = app();
  const evidence = { kind: 'correspondence' as const, id: correspondenceId };
  const dedupe = (kind: string) => `${kind}:${message.messageId ?? `${context.account}:${message.id}`}`;
  const opportunity = getOpportunityRow(opportunityId);
  if (!opportunity) return;
  const mailThread = `${context.account}:${message.threadId}`;
  switch (classification) {
    case 'acknowledgment': {
      stageFromEvidence(opportunityId, { stage: 'applied', outcome: null }, level, { source: sourceKey, evidence, reason, dedupeKey: dedupe('ack'), at: message.receivedAt });
      // A receipt confirms the latest submission that had none.
      db.prepare("UPDATE submissions SET evidence_id = ?, updated_at = ? WHERE id = (SELECT id FROM submissions WHERE opportunity_id = ? AND evidence_id IS NULL ORDER BY applied_on DESC LIMIT 1)").run(correspondenceId, nowAt(), opportunityId);
      return;
    }
    case 'sent_application':
      if (level === 'exact' || level === 'strong') suggestStage(opportunityId, { stage: 'applied', outcome: null }, { source: sourceKey, confidence: level, evidence, reason: 'An application email you sent', dedupeKey: dedupe('sent'), at: message.receivedAt });
      return;
    case 'scheduling': {
      const pending = db.prepare("SELECT * FROM interviews WHERE opportunity_id = ? AND (mail_thread = ? OR status = 'scheduling_needed') ORDER BY created_at DESC LIMIT 1").get(opportunityId, mailThread);
      if (pending && (pending.status === 'scheduling_needed' || (pending.status === 'scheduled' && str(pending.start_at) > nowAt()))) return;
      insertInterview({ opportunityId, sourceKey, origin: 'mail', mailThread, matchBasis: [{ kind: 'thread', detail: `From the email “${excerpt(message.subject, 80)}”` }] },
        { title: `Interview with ${str(opportunity.company)}`, status: 'scheduling_needed', startAt: null, endAt: null, zone: null, allDay: false, format: 'unknown', location: null, meetingLink: meetingLinkIn(message.text), participants: [] }, AUTOMATIC, correspondenceId, message.receivedAt);
      return;
    }
    case 'interview_confirmed':
    case 'reschedule':
    case 'cancellation': {
      const time = inviteInstant(message.invite?.start ?? null) ?? statedInstant(message.text, message.receivedAt);
      const end = inviteInstant(message.invite?.end ?? null);
      const target = findInterviewFor(opportunityId, message.invite?.uid ?? null, mailThread, classification !== 'interview_confirmed');
      if (classification === 'cancellation') {
        if (target) applySourceUpdate(target, { ...sourceValuesOf(target), status: 'canceled' }, { sourceKey, author: AUTOMATIC, evidenceId: correspondenceId, at: message.receivedAt });
        return; // Never a stage change: a canceled meeting is not a rejection.
      }
      const values: InterviewValues = {
        title: message.invite?.summary?.slice(0, 300) || (target ? str(target.title) : `Interview with ${str(opportunity.company)}`),
        status: time ? 'scheduled' : classification === 'reschedule' ? 'scheduling_needed' : 'scheduled',
        startAt: time?.at ?? null,
        endAt: end?.at ?? (time ? new Date(Date.parse(time.at) + 45 * 60000).toISOString() : null),
        zone: time?.zone ?? null,
        allDay: false,
        format: formatFrom(message.text, meetingLinkIn(message.text), null),
        location: null,
        meetingLink: meetingLinkIn(message.text),
        participants: [],
      };
      if (target) {
        const incoming = time ? values : { ...sourceValuesOf(target), status: classification === 'reschedule' ? ('scheduling_needed' as const) : sourceValuesOf(target).status };
        applySourceUpdate(target, incoming, { sourceKey, author: AUTOMATIC, evidenceId: correspondenceId, identity: { icalUid: message.invite?.uid ?? null }, at: message.receivedAt });
      } else {
        insertInterview({ opportunityId, sourceKey, origin: 'mail', icalUid: message.invite?.uid ?? null, mailThread, matchBasis: [{ kind: 'thread', detail: `From the email “${excerpt(message.subject, 80)}”` }] }, values, AUTOMATIC, correspondenceId, message.receivedAt);
      }
      if (time && classification === 'interview_confirmed') stageFromEvidence(opportunityId, { stage: 'interviewing', outcome: null }, level, { source: sourceKey, evidence, reason, dedupeKey: dedupe('interview'), at: message.receivedAt });
      return;
    }
    case 'offer':
      stageFromEvidence(opportunityId, { stage: 'offer', outcome: null }, level, { source: sourceKey, evidence, reason, dedupeKey: dedupe('offer'), at: message.receivedAt });
      return;
    case 'rejection':
      stageFromEvidence(opportunityId, { stage: 'closed', outcome: 'rejected' }, level, { source: sourceKey, evidence, reason, dedupeKey: dedupe('rejection'), at: message.receivedAt });
      return;
    default:
      return;
  }
}

function statedInstant(text: string, receivedAt: string): { at: string; zone: string } | null {
  const stated = parseStatedTime(text, receivedAt);
  if (!stated) return null;
  try {
    return { at: instantFromLocal(stated.local, stated.zone).instant, zone: stated.zone };
  } catch {
    return null;
  }
}

/** The interview a message refers to: same invitation, same thread, or the only open one for the role. */
function findInterviewFor(opportunityId: string, uid: string | null, mailThread: string, allowSingle: boolean): Row | undefined {
  const db = app().db;
  if (uid) {
    const byUid = db.prepare('SELECT * FROM interviews WHERE opportunity_id = ? AND ical_uid = ? LIMIT 1').get(opportunityId, uid);
    if (byUid) return byUid;
  }
  const byThread = db.prepare('SELECT * FROM interviews WHERE opportunity_id = ? AND mail_thread = ? ORDER BY created_at DESC LIMIT 1').get(opportunityId, mailThread);
  if (byThread) return byThread;
  const pending = db.prepare("SELECT * FROM interviews WHERE opportunity_id = ? AND status = 'scheduling_needed' ORDER BY created_at DESC").all(opportunityId);
  if (pending.length === 1) return pending[0];
  if (!allowSingle) return undefined;
  const open = db.prepare("SELECT * FROM interviews WHERE opportunity_id = ? AND status = 'scheduled' AND start_at >= ? ORDER BY start_at").all(opportunityId, nowAt());
  return open.length === 1 ? open[0] : undefined;
}

/** The message was deleted or trashed upstream: label its evidence unavailable and drop its cached body. */
export function markMessageUnavailable(account: string, messageId: string) {
  const { db } = app();
  const row = db.prepare('SELECT id, body_digest FROM correspondence WHERE account = ? AND message_id = ? AND unavailable_at IS NULL').get(account, messageId);
  if (!row) return;
  db.prepare('UPDATE correspondence SET unavailable_at = ?, body_digest = NULL, revision = revision + 1, updated_at = ? WHERE id = ?').run(nowAt(), nowAt(), str(row.id));
  const digest = opt(row.body_digest);
  if (digest && !db.prepare('SELECT 1 FROM correspondence WHERE body_digest = ? LIMIT 1').get(digest)) app().blobs.remove(digest);
  bumpRevision();
}

// ─── Calendar ────────────────────────────────────────────────────────────────

export interface CalendarContext {
  account: string;
  calendarId: string;
  calendarZone: string | null;
}

const INTERVIEW_WORDS = /\b(interview|screen(?:ing)?|phone screen|portfolio (?:review|discussion|presentation)|hiring|recruiter|onsite|on-site|panel|technical|case study|meet the team|final round|chat with|conversation with|coffee chat|culture|fit call|intro call)\b/i;

function eventValues(event: CalendarEvent, context: CalendarContext): InterviewValues {
  const allDay = event.allDay;
  const start = event.start ? (allDay ? `${event.start.slice(0, 10)}T12:00:00.000Z` : new Date(event.start).toISOString()) : null;
  const end = event.end ? (allDay ? `${event.end.slice(0, 10)}T12:00:00.000Z` : new Date(event.end).toISOString()) : null;
  const description = event.description ?? '';
  const link = event.joinUrl ?? meetingLinkIn(`${event.location ?? ''}\n${description}`);
  return {
    title: (event.summary ?? 'Interview').slice(0, 300),
    status: event.cancelled ? 'canceled' : 'scheduled',
    startAt: start,
    endAt: end,
    zone: event.startTimeZone ?? context.calendarZone ?? null,
    allDay,
    format: formatFrom(`${event.summary ?? ''}\n${description}`, link, event.location ?? null),
    location: event.location && !/^https?:\/\//i.test(event.location) ? event.location.slice(0, 500) : null,
    meetingLink: link,
    participants: [
      ...(event.organizer?.email && !event.attendees.some((attendee) => attendee.organizer) ? [{ email: normalizeEmail(event.organizer.email), name: event.organizer.displayName ?? null, role: event.organizer.self ? ('self' as const) : ('organizer' as const), response: null }] : []),
      ...event.attendees.filter((attendee) => !attendee.resource).slice(0, 40).map((attendee) => ({
        email: attendee.email ? normalizeEmail(attendee.email) : null,
        name: attendee.displayName ?? null,
        role: attendee.self ? ('self' as const) : attendee.organizer ? ('organizer' as const) : ('attendee' as const),
        response: attendee.responseStatus ?? null,
      })),
    ],
  };
}

export interface PendingInterview { account: string; calendarId: string; eventKey: string; icalUid: string | null; values: InterviewValues; sourceUpdatedAt: string | null }

/** Apply one calendar event. Unrelated events are not stored. */
export function ingestCalendarEvent(event: CalendarEvent, context: CalendarContext): 'kept' | 'skipped' {
  const { db } = app();
  const sourceKey = accountSource(context.account);
  const key = occurrenceKey(event);
  const existing = db.prepare('SELECT * FROM interviews WHERE account = ? AND calendar_id = ? AND event_key = ?').get(context.account, context.calendarId, key);
  if (existing) {
    if (event.cancelled) markSourceRemoved(existing, sourceKey, AUTOMATIC, event.updated ?? undefined);
    else applySourceUpdate(existing, eventValues(event, context), { sourceKey, author: AUTOMATIC, sourceUpdatedAt: event.updated ?? null });
    return 'kept';
  }
  if (event.cancelled) return 'skipped';
  const values = eventValues(event, context);
  const uid = event.iCalUID ?? null;
  if (uid) {
    const byUid = db.prepare("SELECT * FROM interviews WHERE ical_uid = ? AND (event_key IS NULL OR account IS NULL) ORDER BY created_at DESC LIMIT 1").get(uid);
    if (byUid) {
      applySourceUpdate(byUid, values, { sourceKey, author: AUTOMATIC, identity: { account: context.account, calendarId: context.calendarId, eventKey: key, icalUid: uid, origin: 'calendar' }, sourceUpdatedAt: event.updated ?? null });
      return 'kept';
    }
  }
  const text = `${event.summary ?? ''}\n${event.description ?? ''}\n${event.location ?? ''}`;
  const addresses = values.participants.filter((participant) => participant.role !== 'self' && participant.email).map((participant) => participant.email!);
  const identities = opportunityIdentities();
  const result = matchOpportunity({
    subject: event.summary ?? '', text: `${event.description ?? ''}\n${event.location ?? ''}`, fromName: event.organizer?.displayName ?? null, addresses,
    urls: extractUrls(text), requisitionIds: extractRequisitionIds(text), roleTitles: extractRoleTitles(event.summary ?? '', event.description ?? ''), linkedByThread: [], linkedByReply: [], linkedByInvite: [],
  }, identities);
  const interviewLike = INTERVIEW_WORDS.test(text) || result.candidates.some((candidate) => candidate.evidence.some((entry) => entry.kind === 'contact' || entry.kind === 'company_domain'));
  if (!interviewLike) return 'skipped';
  const pending: PendingInterview = { account: context.account, calendarId: context.calendarId, eventKey: key, icalUid: uid, values, sourceUpdatedAt: event.updated ?? null };
  const groupKey = `cal:${context.account}:${key}`;
  if (groupIgnored(groupKey)) return 'skipped';
  if (result.opportunityId && (result.level === 'exact' || result.level === 'strong' || result.level === 'probable')) {
    const basis = result.candidates.find((candidate) => candidate.opportunityId === result.opportunityId)!.evidence;
    attachCalendarInterview(result.opportunityId, pending, basis, result.level);
    return 'kept';
  }
  if (result.level === 'ambiguous') {
    upsertReview({
      kind: 'match', groupKey, sourceKey, title: values.title,
      summary: `Calendar event${values.startAt ? '' : ' without a time'}. ${result.reason}. Choose the role this interview belongs to, or ignore it.`,
      candidates: result.candidates.map((candidate) => ({ opportunityId: candidate.opportunityId, level: candidate.level === 'weak' ? 'ambiguous' : candidate.level, evidence: candidate.evidence })),
      evidenceIds: [],
      proposal: { stage: 'interviewing', outcome: null, company: null, role: null, classification: 'interview_confirmed', interviewId: null, pendingInterview: pending } as never,
      opportunityId: null,
    });
    return 'kept';
  }
  if (/\binterview\b/i.test(event.summary ?? '')) {
    const domain = addresses.map((address) => address.slice(address.lastIndexOf('@') + 1)).find((value) => !isServiceDomain(value) && !isNoReply(`x@${value}`));
    upsertReview({
      kind: 'new_opportunity', groupKey, sourceKey, title: values.title,
      summary: 'An interview on your calendar that does not match a saved role. Add it as an opportunity, attach it to one, or ignore it.',
      candidates: [], evidenceIds: [],
      proposal: { stage: 'interviewing', outcome: null, company: domain ? sentenceCase(domainLabel(domain) ?? '') || null : null, role: extractRoleTitles(event.summary ?? '', event.description ?? '')[0] ?? null, classification: 'interview_confirmed', interviewId: null, pendingInterview: pending } as never,
      opportunityId: null,
    });
    return 'kept';
  }
  return 'skipped';
}

/** Create or complete the interview for a calendar event matched to an opportunity. A pending invitation becomes this interview. */
export function attachCalendarInterview(opportunityId: string, pending: PendingInterview, basis: EvidenceItem[], level: MatchLevel, author = AUTOMATIC) {
  const { db } = app();
  const sourceKey = accountSource(pending.account);
  // An invitation waiting for a time, or the same interview already confirmed by email, becomes this event.
  const waiting = db.prepare("SELECT * FROM interviews WHERE opportunity_id = ? AND event_key IS NULL AND (status = 'scheduling_needed' OR (status = 'scheduled' AND start_at = ?)) ORDER BY CASE WHEN start_at = ? THEN 0 ELSE 1 END, created_at DESC LIMIT 1").get(opportunityId, pending.values.startAt, pending.values.startAt);
  let interviewId: string;
  if (waiting) {
    applySourceUpdate(waiting, pending.values, { sourceKey, author, identity: { account: pending.account, calendarId: pending.calendarId, eventKey: pending.eventKey, icalUid: pending.icalUid, origin: 'calendar' }, sourceUpdatedAt: pending.sourceUpdatedAt });
    db.prepare('UPDATE interviews SET match_basis = ? WHERE id = ?').run(JSON.stringify(basis.slice(0, 12)), str(waiting.id));
    interviewId = str(waiting.id);
  } else {
    interviewId = str(insertInterview({ opportunityId, sourceKey, origin: 'calendar', account: pending.account, calendarId: pending.calendarId, eventKey: pending.eventKey, icalUid: pending.icalUid, matchBasis: basis, sourceUpdatedAt: pending.sourceUpdatedAt }, pending.values, author, null, pending.sourceUpdatedAt ?? undefined).id);
  }
  if (pending.values.status === 'scheduled' && pending.values.startAt) {
    const reason = 'A matching interview on your calendar';
    if (author === AUTOMATIC) stageFromEvidence(opportunityId, { stage: 'interviewing', outcome: null }, level, { source: sourceKey, evidence: { kind: 'interview', id: interviewId }, reason, dedupeKey: `interview:${pending.account}:${pending.eventKey}`, at: pending.sourceUpdatedAt ?? undefined });
  }
  bumpRevision();
  return interviewId;
}
