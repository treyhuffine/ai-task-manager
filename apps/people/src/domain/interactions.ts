import { AppError } from '@ri/app-kit/contract';
import { boundText, decodeCursor, encodeCursor, type AccessScope } from '@ri/app-kit/data';
import { emailDomain, isPersonalMailDomain, occurrenceKey, withoutQuotedReply, type CalendarEvent, type MailMessage } from '@ri/app-kit/sources';
import { z } from 'zod/v4';
import { iso, newId, type Ctx, type Param } from './context.js';
import { Labels } from './coverage.js';
import { ensureKey, observe, type IdentityKey } from './identity.js';
import { createPersonForKey, getPersonRow, refreshPerson } from './people.js';
import { refreshOrganization } from './organizations.js';
import { observeAffiliation } from './affiliations.js';
import { isBlocked, noteAutoExclusion, senderDecision } from './exclusions.js';
import { personName, organizationRef } from './projection.js';
import { propose, proposeSameName } from './reviews.js';
import { canSee, sourceFilter, touch } from './scope.js';
import { parseSignature } from './signature.js';
import { suggestFact } from './facts.js';
import type { TimelineItem } from '../schemas.js';

/** At most this many non-owner attendees for a meeting to create people automatically. */
export const SMALL_MEETING = 8;
/** A sent message to more recipients than this attaches to known people only. */
export const SMALL_SEND = 8;
export const SIGNATURE_VERSION = 'signature-v1';

export interface IngestResult { interactionId: string | null; persons: Set<string>; organizations: Set<string>; outcome: 'kept' | 'skipped'; reason?: string; extract: boolean }

type InteractionRow = {
  id: string; created_at: string; updated_at: string; revision: number; source_key: string; provider: string; external_id: string; kind: 'email' | 'meeting';
  occurred_at: string; ends_at: string | null; subject: string | null; direction: 'sent' | 'received' | 'meeting'; thread_key: string | null; message_id_header: string | null;
  status: 'active' | 'cancelled' | 'unavailable'; excluded_reason: string | null; included: number; participant_count: number; evidence_id: string | null; digest: string | null;
  attendance: 'unknown' | 'confirmed' | 'not_attended'; owner_response: string | null; time_zone: string | null; recurring_key: string | null; link: string | null;
};

function createEvidence(ctx: Ctx, input: { sourceKey: string; interactionId: string; kind: 'email' | 'event'; text: string | null; title: string; sourceDate: string; participants: string[]; link: string | null; revision: string | null }) {
  const id = newId(), time = iso(ctx);
  const stored = input.text ? boundText(input.text, 20000).text : null;
  const blob = stored ? ctx.blobs.put(stored).digest : null;
  const excerpt = stored ? boundText(stored.replace(/\s+/g, ' ').trim(), 600).text : null;
  ctx.db.run(
    `INSERT INTO evidence (id, created_at, updated_at, source_key, interaction_id, kind, blob_digest, excerpt, source_date, title, participants, link, source_revision, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')`,
    id, time, time, input.sourceKey, input.interactionId, input.kind, blob, excerpt, input.sourceDate, input.title.slice(0, 400), JSON.stringify(input.participants.slice(0, 30)), input.link, input.revision,
  );
  return id;
}

function ownerSentTo(ctx: Ctx, sourceKey: string, threadKey: string, keyId: string): boolean {
  return !!ctx.db.get(
    "SELECT 1 AS ok FROM interactions i JOIN interaction_participants ip ON ip.interaction_id = i.id WHERE i.source_key = ? AND i.thread_key = ? AND i.direction = 'sent' AND ip.key_id = ? LIMIT 1",
    sourceKey, threadKey, keyId);
}
function repliesToOwner(ctx: Ctx, sourceKey: string, ids: string[]): boolean {
  if (!ids.length) return false;
  return !!ctx.db.get(`SELECT 1 AS ok FROM interactions WHERE source_key = ? AND direction = 'sent' AND message_id_header IN (${ids.map(() => '?').join(',')}) LIMIT 1`, sourceKey, ...ids.slice(0, 50));
}

/**
 * Deterministic linking for one message. Sent mail and confirmed direct
 * replies may create people. Bulk, list and no-reply mail is left out before
 * any AI and only counted. Shared inboxes never become a person. A user's
 * exclusion, inclusion or suppression always wins.
 */
export function ingestMail(ctx: Ctx, sourceKey: string, message: MailMessage, owner: ReadonlySet<string>): IngestResult {
  const result: IngestResult = { interactionId: null, persons: new Set(), organizations: new Set(), outcome: 'skipped', extract: false };
  if (message.draft || message.discarded) return { ...result, reason: 'draft or discarded' };
  const existing = ctx.db.get<{ id: string }>('SELECT id FROM interactions WHERE source_key = ? AND external_id = ?', sourceKey, message.id);
  if (existing) return { ...result, interactionId: existing.id, outcome: 'kept', reason: 'already stored' };
  const isOwner = (address: string) => owner.has(address.toLowerCase()) || owner.has(address);
  const sent = message.sent || (!!message.from && isOwner(message.from.normalized));
  const from = message.from;
  if (!sent && from) {
    const decision = senderDecision(ctx, from.normalized);
    if (isBlocked(decision)) return { ...result, reason: 'excluded sender' };
    if (message.bulkReasons.length && decision !== 'included') {
      noteAutoExclusion(ctx, from.normalized, message.bulkReasons.join(', '), sourceKey);
      return { ...result, reason: 'bulk' };
    }
  }
  const external = [
    ...(from && !sent ? [{ address: from, role: 'from' as const }] : []),
    ...message.to.map((address) => ({ address, role: 'to' as const })),
    ...message.cc.map((address) => ({ address, role: 'cc' as const })),
    ...(sent ? message.bcc.map((address) => ({ address, role: 'bcc' as const })) : []),
  ].filter((item) => !isOwner(item.address.normalized));
  const unique = new Map<string, (typeof external)[number]>();
  for (const item of external) if (!unique.has(item.address.normalized)) unique.set(item.address.normalized, item);
  const participants = [...unique.values()].filter((item) => !isBlocked(senderDecision(ctx, item.address.normalized))).slice(0, 200);
  if (!participants.length) return { ...result, reason: 'no other participants' };
  const ownerAddressed = [...message.to, ...message.cc].some((address) => isOwner(address.normalized));
  const time = iso(ctx), id = newId();
  const recipientCount = participants.filter((item) => item.role !== 'from').length;
  ctx.db.run(
    `INSERT INTO interactions (id, created_at, updated_at, revision, source_key, provider, external_id, kind, occurred_at, ends_at, subject, direction, thread_key, message_id_header, status, excluded_reason, included, participant_count, evidence_id, digest, attendance, owner_response, time_zone, recurring_key, link)
     VALUES (?, ?, ?, 1, ?, 'gmail', ?, 'email', ?, NULL, ?, ?, ?, ?, 'active', NULL, 0, ?, NULL, ?, 'unknown', NULL, NULL, NULL, ?)`,
    id, time, time, sourceKey, message.id, message.receivedAt, message.subject || null, sent ? 'sent' : 'received', message.threadId, message.messageId, participants.length, message.digest,
    `https://mail.google.com/mail/#all/${encodeURIComponent(message.id)}`,
  );
  const body = withoutQuotedReply(message.text);
  const evidenceId = createEvidence(ctx, {
    sourceKey, interactionId: id, kind: 'email', text: body, title: message.subject || '(no subject)', sourceDate: message.receivedAt,
    participants: [...(from ? [from.name ? `${from.name} <${from.address}>` : from.address] : []), ...participants.filter((item) => item.role !== 'from').map((item) => item.address.name ? `${item.address.name} <${item.address.address}>` : item.address.address)],
    link: `https://mail.google.com/mail/#all/${encodeURIComponent(message.id)}`, revision: message.digest,
  });
  ctx.db.run('UPDATE interactions SET evidence_id = ? WHERE id = ?', evidenceId, id);
  const reply = !sent && from && (repliesToOwner(ctx, sourceKey, [message.inReplyTo, ...message.references].filter((value): value is string => !!value)));
  for (const item of participants) {
    const key = ensureKey(ctx, 'email', item.address.address);
    if (!key) continue;
    observe(ctx, { keyId: key.id, sourceKey, value: item.address.address, name: item.address.name, at: message.receivedAt, evidenceId });
    let personId = key.ownerKind === 'person' ? key.ownerId : null;
    const direct = sent ? recipientCount <= SMALL_SEND : item.role === 'from' && ownerAddressed;
    if (!personId && !key.shared && key.decision === 'auto') {
      const confirmedReply = item.role === 'from' && (reply || ownerSentTo(ctx, sourceKey, message.threadId, key.id));
      if (sent && recipientCount <= SMALL_SEND) personId = createPersonForKey(ctx, key.id, 'sent_mail');
      else if (confirmedReply) personId = createPersonForKey(ctx, key.id, 'reply');
      else if (item.role === 'from' && ownerAddressed && senderDecision(ctx, key.normalized) === 'included') personId = createPersonForKey(ctx, key.id, 'incoming');
      else if (item.role === 'from' && ownerAddressed)
        propose(ctx, { kind: 'sender', leftId: key.id, keyId: key.id, reason: 'incoming_only', sourceKey, evidence: { summary: `${item.address.address} wrote to you but you have not replied in the indexed history. Include them as a person, or keep them out.`, evidenceIds: [evidenceId] } });
      if (personId) {
        result.persons.add(personId);
        newPersonFollowUps(ctx, personId, key, sourceKey);
      }
    }
    ctx.db.run(
      `INSERT INTO interaction_participants (id, created_at, updated_at, interaction_id, key_id, person_id, role, source_key, occurred_at, kind, direct, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'email', ?, 1) ON CONFLICT(interaction_id, key_id) DO NOTHING`,
      `${id}:${key.id}`, time, time, id, key.id, personId, item.role, sourceKey, message.receivedAt, direct ? 1 : 0,
    );
    if (personId) result.persons.add(personId);
  }
  // A known sender's signature can propose an alias or an affiliation. Proposals only.
  if (!sent && from) {
    const key = ensureKey(ctx, 'email', from.address);
    const personId = key?.ownerKind === 'person' ? key.ownerId : null;
    if (key && personId) {
      const found = parseSignature(body, { name: from.name, address: from.address });
      if (found) {
        for (const email of found.emails) {
          const alias = ensureKey(ctx, 'email', email);
          if (!alias || alias.shared || alias.ownerId === personId) continue;
          if (alias.ownerKind === 'person' && alias.ownerId) propose(ctx, { kind: 'person', leftId: alias.ownerId, rightId: personId, reason: 'signature_alias', sourceKey, evidence: { summary: `${from.address} lists ${email} in a signature, and ${email} belongs to another record.`, evidenceIds: [evidenceId], passage: found.passage, shared: [email] } });
          else propose(ctx, { kind: 'alias', leftId: personId, keyId: alias.id, reason: 'signature_alias', sourceKey, evidence: { summary: `A signature from ${from.address} lists ${email}. Add it as another address for this person?`, evidenceIds: [evidenceId], passage: found.passage } });
        }
        if (found.role && found.company)
          suggestFact(ctx, { subjectKind: 'person', subjectId: personId, field: 'affiliation', value: `${found.role} at ${found.company}`, detail: { role: found.role, organization: found.company }, evidenceId, sourceKey, sourceRevision: message.digest, passage: found.passage, observedAt: message.receivedAt, origin: 'signature', extractionVersion: SIGNATURE_VERSION, anchor: `email:${from.normalized}` });
      }
    }
  }
  result.interactionId = id;
  result.outcome = 'kept';
  result.extract = !message.bulkReasons.length && participants.some((item) => {
    const owned = ctx.db.get<{ person_id: string | null }>('SELECT person_id FROM interaction_participants WHERE interaction_id = ? AND key_id = (SELECT id FROM identity_keys WHERE kind = \'email\' AND normalized = ?)', id, item.address.normalized);
    return !!owned?.person_id;
  });
  return result;
}

/** After a person appears: ask about same-name records and company domains, never decide. */
function newPersonFollowUps(ctx: Ctx, personId: string, key: IdentityKey, sourceKey: string) {
  refreshPerson(ctx, personId);
  proposeSameName(ctx, personId, sourceKey);
  const domain = emailDomain(key.normalized);
  if (!domain || isPersonalMailDomain(domain)) return;
  for (const org of ctx.db.all<{ organization_id: string }>('SELECT DISTINCT organization_id FROM organization_domains WHERE domain = ? LIMIT 3', domain))
    observeAffiliation(ctx, { personId, organizationId: org.organization_id, role: null, sourceKey, origin: 'domain', observedAt: iso(ctx), confidence: 'suggested' });
}

/**
 * One calendar occurrence. A small meeting with the owner may create people.
 * A large event is kept out and counted. A canceled event is kept as canceled.
 * Nothing here records attendance: the event only shows a meeting was scheduled.
 */
export function ingestEvent(ctx: Ctx, sourceKey: string, calendarId: string, event: CalendarEvent, calendarTimeZone: string | null): IngestResult {
  const result: IngestResult = { interactionId: null, persons: new Set(), organizations: new Set(), outcome: 'skipped', extract: false };
  const externalId = `${calendarId}:${occurrenceKey(event)}`;
  const existing = ctx.db.get<InteractionRow>('SELECT * FROM interactions WHERE source_key = ? AND external_id = ?', sourceKey, externalId);
  const time = iso(ctx);
  const attendees = event.attendees.filter((attendee) => !attendee.resource && !attendee.self && attendee.email);
  const ownerInvolved = event.organizer?.self || event.attendees.some((attendee) => attendee.self);
  if (event.cancelled) {
    if (!existing) return { ...result, reason: 'canceled before it was seen' };
    ctx.db.run("UPDATE interactions SET status = 'cancelled', revision = revision + 1, updated_at = ? WHERE id = ?", time, existing.id);
    ctx.db.run('UPDATE interaction_participants SET active = 0, updated_at = ? WHERE interaction_id = ?', time, existing.id);
    for (const row of ctx.db.all<{ person_id: string | null }>('SELECT person_id FROM interaction_participants WHERE interaction_id = ?', existing.id)) if (row.person_id) result.persons.add(row.person_id);
    return { ...result, interactionId: existing.id, outcome: 'kept', reason: 'canceled' };
  }
  if (!attendees.length || !ownerInvolved || !event.start) {
    if (existing) {
      ctx.db.run("UPDATE interactions SET status = 'unavailable', updated_at = ? WHERE id = ?", time, existing.id);
      ctx.db.run('UPDATE interaction_participants SET active = 0, updated_at = ? WHERE interaction_id = ?', time, existing.id);
    }
    return { ...result, reason: 'no other attendees with the owner' };
  }
  const large = attendees.length > SMALL_MEETING;
  const start = event.allDay ? `${event.start.slice(0, 10)}T00:00:00.000Z` : new Date(event.start).toISOString();
  const end = event.end ? (event.allDay ? `${event.end.slice(0, 10)}T00:00:00.000Z` : new Date(event.end).toISOString()) : null;
  const self = event.attendees.find((attendee) => attendee.self);
  const ownerResponse = self?.responseStatus ?? (event.organizer?.self ? 'organizer' : null);
  const declined = ownerResponse === 'declined';
  let id = existing?.id;
  const included = existing?.included ?? 0;
  const excluded = large && !included ? 'large_event' : null;
  if (existing) {
    ctx.db.run(
      `UPDATE interactions SET occurred_at = ?, ends_at = ?, subject = ?, status = 'active', excluded_reason = ?, participant_count = ?, owner_response = ?, time_zone = ?, recurring_key = ?, link = ?, digest = ?, revision = revision + 1, updated_at = ? WHERE id = ?`,
      start, end, event.summary ?? null, excluded, attendees.length, ownerResponse, event.startTimeZone ?? calendarTimeZone, event.recurringEventId ?? null, event.htmlLink ?? null, event.updated ?? null, time, existing.id,
    );
  } else {
    id = newId();
    ctx.db.run(
      `INSERT INTO interactions (id, created_at, updated_at, revision, source_key, provider, external_id, kind, occurred_at, ends_at, subject, direction, thread_key, message_id_header, status, excluded_reason, included, participant_count, evidence_id, digest, attendance, owner_response, time_zone, recurring_key, link)
       VALUES (?, ?, ?, 1, ?, 'google_calendar', ?, 'meeting', ?, ?, ?, 'meeting', ?, NULL, 'active', ?, 0, ?, NULL, ?, 'unknown', ?, ?, ?, ?)`,
      id, time, time, sourceKey, externalId, start, end, event.summary ?? null, event.recurringEventId ?? event.iCalUID ?? null, excluded, attendees.length, event.updated ?? null, ownerResponse,
      event.startTimeZone ?? calendarTimeZone, event.recurringEventId ?? null, event.htmlLink ?? null,
    );
    const evidenceId = createEvidence(ctx, {
      sourceKey, interactionId: id, kind: 'event', text: event.description ? event.description.slice(0, 4000) : null, title: event.summary ?? 'Calendar event', sourceDate: start,
      participants: attendees.slice(0, 30).map((attendee) => attendee.displayName ? `${attendee.displayName} <${attendee.email}>` : attendee.email!), link: event.htmlLink ?? null, revision: event.updated ?? null,
    });
    ctx.db.run('UPDATE interactions SET evidence_id = ? WHERE id = ?', evidenceId, id);
  }
  const seen = new Set<string>();
  for (const attendee of attendees.slice(0, 300)) {
    const key = ensureKey(ctx, 'email', attendee.email!);
    if (!key || seen.has(key.id)) continue;
    seen.add(key.id);
    if (isBlocked(senderDecision(ctx, key.normalized))) continue;
    observe(ctx, { keyId: key.id, sourceKey, value: attendee.email!, name: attendee.displayName ?? null, at: start });
    let personId = key.ownerKind === 'person' ? key.ownerId : null;
    if (!personId && !large && !declined && !key.shared && key.decision === 'auto') {
      personId = createPersonForKey(ctx, key.id, 'meeting');
      newPersonFollowUps(ctx, personId, key, sourceKey);
    }
    const role = attendee.organizer ? 'organizer' : 'attendee';
    ctx.db.run(
      `INSERT INTO interaction_participants (id, created_at, updated_at, interaction_id, key_id, person_id, role, source_key, occurred_at, kind, direct, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'meeting', 0, ?)
       ON CONFLICT(interaction_id, key_id) DO UPDATE SET person_id = excluded.person_id, occurred_at = excluded.occurred_at, active = excluded.active, updated_at = excluded.updated_at`,
      `${id}:${key.id}`, time, time, id!, key.id, personId, role, sourceKey, start, large && !included ? 0 : 1,
    );
    if (personId) result.persons.add(personId);
  }
  for (const row of ctx.db.all<{ key_id: string; person_id: string | null }>('SELECT key_id, person_id FROM interaction_participants WHERE interaction_id = ?', id!))
    if (!seen.has(row.key_id)) {
      ctx.db.run('DELETE FROM interaction_participants WHERE interaction_id = ? AND key_id = ?', id!, row.key_id);
      if (row.person_id) result.persons.add(row.person_id);
    }
  return { ...result, interactionId: id!, outcome: 'kept' };
}

/**
 * The provider deleted or trashed this item. Keep a placeholder that says so,
 * drop its stored text, withdraw suggestions that rested on it, and never
 * invent any other change.
 */
export function markUnavailable(ctx: Ctx, sourceKey: string, externalId: string): Set<string> {
  const persons = new Set<string>();
  const row = ctx.db.get<InteractionRow>('SELECT * FROM interactions WHERE source_key = ? AND external_id = ?', sourceKey, externalId);
  if (!row || row.status === 'unavailable') return persons;
  const time = iso(ctx);
  ctx.db.run("UPDATE interactions SET status = 'unavailable', subject = NULL, revision = revision + 1, updated_at = ? WHERE id = ?", time, row.id);
  ctx.db.run('UPDATE interaction_participants SET active = 0, updated_at = ? WHERE interaction_id = ?', time, row.id);
  for (const evidence of ctx.db.all<{ id: string; blob_digest: string | null }>('SELECT id, blob_digest FROM evidence WHERE interaction_id = ?', row.id)) {
    if (evidence.blob_digest && !ctx.db.get('SELECT 1 AS ok FROM evidence WHERE blob_digest = ? AND id != ? AND status = \'available\'', evidence.blob_digest, evidence.id)) ctx.blobs.remove(evidence.blob_digest);
    ctx.db.run("UPDATE evidence SET status = 'unavailable', blob_digest = NULL, excerpt = NULL, title = 'Message no longer available', updated_at = ? WHERE id = ?", time, evidence.id);
  }
  for (const commitment of ctx.db.all<{ id: string; state: string; person_id: string | null }>("SELECT id, state, person_id FROM commitments WHERE interaction_id = ? AND state = 'suggested'", row.id)) {
    ctx.db.run("UPDATE commitments SET state = 'withdrawn', resolution = 'The source message is no longer available', passage = NULL, revision = revision + 1, updated_at = ? WHERE id = ?", time, commitment.id);
    ctx.db.run("INSERT INTO commitment_history (id, created_at, updated_at, commitment_id, from_state, to_state, actor, note, evidence_id) VALUES (?, ?, ?, ?, 'suggested', 'withdrawn', 'extraction', 'The source message is no longer available', NULL)", newId(), time, time, commitment.id);
  }
  ctx.db.run("UPDATE facts SET status = 'withdrawn', resolution = 'The source is no longer available', passage = NULL, revision = revision + 1, updated_at = ? WHERE status = 'suggested' AND evidence_id IN (SELECT id FROM evidence WHERE interaction_id = ?)", time, row.id);
  ctx.db.run("UPDATE work_items SET state = 'cancelled', updated_at = ? WHERE kind = 'extract' AND state = 'pending' AND dedupe_key LIKE ?", time, `extract:${row.id}:%`);
  for (const participant of ctx.db.all<{ person_id: string | null }>('SELECT person_id FROM interaction_participants WHERE interaction_id = ?', row.id)) if (participant.person_id) persons.add(participant.person_id);
  return persons;
}

// ─── Timeline ────────────────────────────────────────────────────────────────

const timelineCursor = z.object({ at: z.string(), id: z.string() }).strict();
export type TimelineSubject = { kind: 'person' | 'organization' | 'opportunity'; id: string };

function meetingLabel(row: InteractionRow, now: string) {
  if (row.status === 'cancelled') return 'Canceled calendar event';
  if (row.status === 'unavailable') return 'Calendar event no longer available';
  if (row.occurred_at >= now) return 'Meeting scheduled';
  if (row.attendance === 'confirmed') return 'Meeting, attendance confirmed by you';
  if (row.attendance === 'not_attended') return 'Past calendar event, not attended';
  return 'Past calendar event';
}
function meetingDetail(row: InteractionRow) {
  if (row.status === 'cancelled') return 'Canceled in the calendar. Attendance not inferred';
  if (row.owner_response === 'declined') return 'You declined in the calendar. Attendance not inferred';
  if (row.attendance === 'confirmed') return 'Calendar entry. Attendance confirmed by you';
  return 'Calendar entry. Attendance not inferred';
}

export function projectInteraction(ctx: Ctx, scope: AccessScope, row: InteractionRow, labels: Labels, now: string, threadCount?: number): TimelineItem {
  const filter = sourceFilter(scope, 'ip.source_key');
  const participants = ctx.db.all<{ person_id: string | null; normalized: string; observed_name: string | null }>(
    `SELECT ip.person_id, k.normalized, o.observed_name FROM interaction_participants ip JOIN identity_keys k ON k.id = ip.key_id
     LEFT JOIN identity_observations o ON o.key_id = ip.key_id AND o.source_key = ip.source_key
     WHERE ip.interaction_id = ? AND ${filter.sql} ORDER BY ip.role = 'from' DESC, ip.role LIMIT 21`, row.id, ...filter.params);
  const people = participants.slice(0, 20).map((participant) => {
    const person = participant.person_id ? getPersonRow(ctx, participant.person_id) : undefined;
    return { personId: person && !person.merged_into ? person.id : null, name: person && !person.merged_into ? personName(ctx, scope, person) : participant.observed_name ?? participant.normalized };
  });
  const lc = sourceFilter(scope, 'collection');
  const links = ctx.db.all<{ target_kind: 'organization' | 'opportunity'; target_id: string; origin: 'manual' | 'rule' }>(
    `SELECT DISTINCT target_kind, target_id, origin FROM interaction_links WHERE interaction_id = ? AND state = 'linked' AND ${lc.sql} LIMIT 10`, row.id, ...lc.params)
    .flatMap((link): TimelineItem['links'] => {
      if (link.target_kind === 'organization') { const organization = organizationRef(ctx, scope, link.target_id); return organization ? [{ kind: link.target_kind, id: organization.id, name: organization.name, origin: link.origin }] : []; }
      const opportunity = ctx.db.get<{ id: string; title: string; collection: string }>('SELECT id, title, collection FROM opportunities WHERE id = ?', link.target_id);
      return opportunity && canSee(scope, opportunity.collection) ? [{ kind: link.target_kind, id: opportunity.id, name: opportunity.title, origin: link.origin }] : [];
    });
  const evidence = row.evidence_id ? ctx.db.get<{ excerpt: string | null; status: string }>('SELECT excerpt, status FROM evidence WHERE id = ?', row.evidence_id) : undefined;
  const email = row.kind === 'email';
  return {
    id: row.id,
    type: email ? 'email' : 'meeting',
    occurredAt: row.occurred_at,
    label: email ? (row.status === 'unavailable' ? 'Email no longer available' : row.direction === 'sent' ? 'Email sent' : 'Email received') : meetingLabel(row, now),
    title: row.status === 'unavailable' ? (email ? 'Removed from the mailbox' : 'Removed from the calendar') : row.subject?.trim() || (email ? '(no subject)' : 'Calendar event'),
    detail: email ? (evidence?.status === 'available' ? evidence.excerpt : null) : meetingDetail(row),
    sourceLabel: labels.of(row.source_key),
    participants: people,
    moreParticipants: Math.max(0, row.participant_count - people.length),
    evidenceId: row.status === 'unavailable' ? null : row.evidence_id,
    link: row.status === 'unavailable' ? null : row.link,
    status: row.status === 'active' && !email && row.occurred_at >= now ? 'upcoming' : row.status,
    attendance: email ? null : row.attendance,
    links,
    revision: row.revision,
    ...(threadCount && threadCount > 1 ? { threadCount } : {}),
  };
}

/**
 * A merged, paginated timeline of emails, meetings, notes and your changes,
 * sorted by event time with a stable ID tie-breaker. Company activity shows
 * only explicitly linked or attributed conversations, one row per thread.
 */
export function listTimeline(ctx: Ctx, scope: AccessScope, input: { subject: TimelineSubject; cursor?: string; limit: number; include?: ('email' | 'meeting' | 'note' | 'change')[]; from?: string; to?: string }) {
  const labels = new Labels(ctx);
  const now = iso(ctx);
  const include = new Set(input.include ?? ['email', 'meeting', 'note', 'change']);
  const cursor = decodeCursor(timelineCursor, input.cursor);
  const fetch = input.limit + 1;
  const range = (column: string) => {
    const parts: string[] = [], params: Param[] = [];
    if (input.from) { parts.push(`${column} >= ?`); params.push(input.from); }
    if (input.to) { parts.push(`${column} < ?`); params.push(input.to); }
    if (cursor) { parts.push(`(${column}, id) < (?, ?)`); params.push(cursor.at, cursor.id); }
    return { sql: parts.length ? `AND ${parts.join(' AND ')}` : '', params };
  };
  type Entry = { at: string; id: string; item: TimelineItem };
  const entries: Entry[] = [];
  const kinds = [...include].filter((kind) => kind === 'email' || kind === 'meeting');
  if (kinds.length) {
    if (input.subject.kind === 'person') {
      const filter = sourceFilter(scope, 'ip.source_key');
      const r = range('i.occurred_at');
      const rows = ctx.db.all<InteractionRow>(
        `SELECT i.* FROM interaction_participants ip JOIN interactions i ON i.id = ip.interaction_id
         WHERE ip.person_id = ? AND ${filter.sql} AND i.kind IN (${kinds.map(() => '?').join(',')}) AND (i.excluded_reason IS NULL OR i.included = 1) ${r.sql.replaceAll('(i.occurred_at, id)', '(i.occurred_at, i.id)')}
         ORDER BY i.occurred_at DESC, i.id DESC LIMIT ?`, input.subject.id, ...filter.params, ...kinds, ...r.params, fetch);
      for (const row of rows) entries.push({ at: row.occurred_at, id: row.id, item: projectInteraction(ctx, scope, row, labels, now) });
    } else {
      const targetKind = input.subject.kind;
      const s = sourceFilter(scope, 'l.source_key'), c = sourceFilter(scope, 'l.collection');
      const params: Param[] = [targetKind, input.subject.id, ...s.params, ...c.params, targetKind, ...kinds];
      let having = '';
      if (cursor) { having = 'HAVING (at, thread) < (?, ?)'; }
      const rows = ctx.db.all<{ thread: string; at: string; latest: string; count: number }>(
        `SELECT COALESCE(i.source_key || ':' || i.thread_key, i.id) AS thread, MAX(i.occurred_at) AS at, COUNT(DISTINCT i.id) AS count,
                (SELECT i2.id FROM interactions i2 JOIN interaction_links l2 ON l2.interaction_id = i2.id WHERE l2.target_kind = l.target_kind AND l2.target_id = l.target_id AND l2.state = 'linked' AND COALESCE(i2.source_key || ':' || i2.thread_key, i2.id) = COALESCE(i.source_key || ':' || i.thread_key, i.id) ORDER BY i2.occurred_at DESC, i2.id DESC LIMIT 1) AS latest
         FROM interaction_links l JOIN interactions i ON i.id = l.interaction_id
         WHERE l.target_kind = ? AND l.target_id = ? AND l.state = 'linked' AND ${s.sql} AND ${c.sql}
           AND NOT EXISTS (SELECT 1 FROM interaction_links x WHERE x.interaction_id = l.interaction_id AND x.target_kind = ? AND x.target_id = l.target_id AND x.state = 'excluded')
           AND i.kind IN (${kinds.map(() => '?').join(',')}) ${input.from ? 'AND i.occurred_at >= ?' : ''} ${input.to ? 'AND i.occurred_at < ?' : ''}
         GROUP BY thread ${having} ORDER BY at DESC, thread DESC LIMIT ?`,
        ...params, ...(input.from ? [input.from] : []), ...(input.to ? [input.to] : []), ...(cursor ? [cursor.at, cursor.id] : []), fetch);
      for (const row of rows) {
        const interaction = ctx.db.get<InteractionRow>('SELECT * FROM interactions WHERE id = ?', row.latest);
        if (interaction) entries.push({ at: row.at, id: row.thread, item: { ...projectInteraction(ctx, scope, interaction, labels, now, Number(row.count)), id: interaction.id } });
      }
    }
  }
  if (include.has('note')) {
    const filter = sourceFilter(scope, 'collection');
    const r = range('updated_at');
    for (const note of ctx.db.all<{ id: string; title: string | null; body: string; updated_at: string; collection: string; revision: number }>(
      `SELECT id, title, body, updated_at, collection, revision FROM notes WHERE subject_kind = ? AND subject_id = ? AND archived_at IS NULL AND ${filter.sql} ${r.sql} ORDER BY updated_at DESC, id DESC LIMIT ?`,
      input.subject.kind, input.subject.id, ...filter.params, ...r.params, fetch))
      entries.push({ at: note.updated_at, id: note.id, item: { id: note.id, type: 'note', occurredAt: note.updated_at, label: 'Your note', title: note.title ?? 'Note', detail: boundText(note.body, 600).text, sourceLabel: labels.of(note.collection), participants: [], moreParticipants: 0, evidenceId: null, link: null, status: 'active', attendance: null, links: [], revision: note.revision } });
  }
  if (include.has('change')) {
    const changes: { at: string; id: string; title: string; detail: string | null; source: string }[] = [];
    const r = range('h.created_at');
    const c = sourceFilter(scope, 'c.source_key');
    const column = input.subject.kind === 'person' ? 'c.person_id' : input.subject.kind === 'organization' ? 'c.organization_id' : 'c.opportunity_id';
    for (const row of ctx.db.all<{ id: string; created_at: string; to_state: string; note: string | null; action: string; source_key: string }>(
      `SELECT h.id, h.created_at, h.to_state, h.note, c.action, c.source_key FROM commitment_history h JOIN commitments c ON c.id = h.commitment_id
       WHERE ${column} = ? AND h.actor != 'extraction' AND ${c.sql} ${r.sql.replaceAll('(h.created_at, id)', '(h.created_at, h.id)')} ORDER BY h.created_at DESC, h.id DESC LIMIT ?`, input.subject.id, ...c.params, ...r.params, fetch))
      changes.push({ at: row.created_at, id: row.id, title: row.action, detail: row.note, source: row.source_key });
    const o = sourceFilter(scope, 'o.collection');
    const stageRows = input.subject.kind === 'opportunity'
      ? ctx.db.all<{ id: string; created_at: string; title: string; label: string; reason: string | null; collection: string }>(
        `SELECT s.id, s.created_at, o.title, st.label, s.reason, o.collection FROM stage_changes s JOIN opportunities o ON o.id = s.opportunity_id JOIN pipeline_stages st ON st.id = s.to_stage_id WHERE s.opportunity_id = ? AND ${o.sql} ${range('s.created_at').sql.replaceAll('(s.created_at, id)', '(s.created_at, s.id)')} ORDER BY s.created_at DESC, s.id DESC LIMIT ?`, input.subject.id, ...o.params, ...range('s.created_at').params, fetch)
      : input.subject.kind === 'person'
        ? ctx.db.all<{ id: string; created_at: string; title: string; label: string; reason: string | null; collection: string }>(
          `SELECT s.id, s.created_at, o.title, st.label, s.reason, o.collection FROM stage_changes s JOIN opportunities o ON o.id = s.opportunity_id JOIN pipeline_stages st ON st.id = s.to_stage_id JOIN opportunity_people op ON op.opportunity_id = o.id WHERE op.person_id = ? AND ${o.sql} ${range('s.created_at').sql.replaceAll('(s.created_at, id)', '(s.created_at, s.id)')} ORDER BY s.created_at DESC, s.id DESC LIMIT ?`, input.subject.id, ...o.params, ...range('s.created_at').params, fetch)
        : ctx.db.all<{ id: string; created_at: string; title: string; label: string; reason: string | null; collection: string }>(
          `SELECT s.id, s.created_at, o.title, st.label, s.reason, o.collection FROM stage_changes s JOIN opportunities o ON o.id = s.opportunity_id JOIN pipeline_stages st ON st.id = s.to_stage_id WHERE o.organization_id = ? AND ${o.sql} ${range('s.created_at').sql.replaceAll('(s.created_at, id)', '(s.created_at, s.id)')} ORDER BY s.created_at DESC, s.id DESC LIMIT ?`, input.subject.id, ...o.params, ...range('s.created_at').params, fetch);
    for (const row of stageRows) changes.push({ at: row.created_at, id: row.id, title: `${row.title} moved to ${row.label}`, detail: row.reason, source: row.collection });
    for (const change of changes) entries.push({ at: change.at, id: change.id, item: { id: change.id, type: 'change', occurredAt: change.at, label: 'Your change', title: change.title.slice(0, 400), detail: change.detail, sourceLabel: labels.of(change.source), participants: [], moreParticipants: 0, evidenceId: null, link: null, status: 'active', attendance: null, links: [], revision: 1 } });
  }
  entries.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
  const page = entries.slice(0, input.limit);
  const last = page.at(-1);
  return { items: page.map((entry) => entry.item), nextCursor: entries.length > input.limit && last ? encodeCursor({ at: last.at, id: last.id }) : null };
}

// ─── User decisions on an interaction ────────────────────────────────────────

export function getInteractionRow(ctx: Ctx, scope: AccessScope, id: string) {
  const row = ctx.db.get<InteractionRow>('SELECT * FROM interactions WHERE id = ?', id);
  return row && canSee(scope, row.source_key) ? row : null;
}

/**
 * Link or unlink an interaction to a company or opportunity, exclude it from
 * a company's activity, confirm attendance or include a large event. Every
 * decision is recorded as yours and survives resync.
 */
export function linkInteraction(ctx: Ctx, scope: AccessScope, input: {
  interactionId: string; expectedRevision: number;
  operation: 'link' | 'unlink' | 'exclude' | 'confirm_attendance' | 'not_attended' | 'clear_attendance' | 'include_event';
  target?: { kind: 'organization' | 'opportunity'; id: string }; collection?: string;
}, writable: (requested?: string) => string): { status: 'saved' | 'conflict'; id: string; message?: string; affected: { persons: string[]; organizations: string[] } } {
  const row = getInteractionRow(ctx, scope, input.interactionId);
  if (!row) throw new AppError('not_found', 'This conversation is no longer available');
  if (row.revision !== input.expectedRevision) return { status: 'conflict', id: row.id, message: 'This conversation changed since you opened it. Try again', affected: { persons: [], organizations: [] } };
  const time = iso(ctx);
  const affected = { persons: [] as string[], organizations: [] as string[] };
  const bump = () => ctx.db.run('UPDATE interactions SET revision = revision + 1, updated_at = ? WHERE id = ?', time, row.id);
  switch (input.operation) {
    case 'confirm_attendance': case 'not_attended': case 'clear_attendance':
      if (row.kind !== 'meeting') throw new AppError('invalid_input', 'Only a meeting has attendance');
      if (input.operation === 'confirm_attendance' && row.occurred_at > time) throw new AppError('invalid_input', 'Confirm attendance after the meeting');
      writable();
      ctx.db.run('UPDATE interactions SET attendance = ?, revision = revision + 1, updated_at = ? WHERE id = ?', input.operation === 'confirm_attendance' ? 'confirmed' : input.operation === 'not_attended' ? 'not_attended' : 'unknown', time, row.id);
      break;
    case 'include_event':
      if (row.excluded_reason !== 'large_event') throw new AppError('invalid_input', 'Only a large event can be included');
      writable();
      ctx.db.run('UPDATE interactions SET included = 1, excluded_reason = NULL, revision = revision + 1, updated_at = ? WHERE id = ?', time, row.id);
      ctx.db.run('UPDATE interaction_participants SET active = 1, updated_at = ? WHERE interaction_id = ?', time, row.id);
      for (const participant of ctx.db.all<{ person_id: string | null }>('SELECT person_id FROM interaction_participants WHERE interaction_id = ?', row.id)) if (participant.person_id) affected.persons.push(participant.person_id);
      break;
    default: {
      if (!input.target) throw new AppError('invalid_input', 'Choose a company or opportunity');
      const target = input.target;
      if (target.kind === 'organization' && !organizationRef(ctx, scope, target.id)) throw new AppError('not_found', 'That company is no longer available');
      if (target.kind === 'opportunity') { const opportunity = ctx.db.get<{ collection: string }>('SELECT collection FROM opportunities WHERE id = ?', target.id); if (!opportunity || !canSee(scope, opportunity.collection)) throw new AppError('not_found', 'That opportunity is no longer available'); }
      if (input.operation === 'link') {
        const collection = writable(input.collection);
        ctx.db.run(
          `INSERT INTO interaction_links (id, created_at, updated_at, revision, interaction_id, target_kind, target_id, state, origin, rule_id, collection, source_key, occurred_at, thread_key)
           VALUES (?, ?, ?, 1, ?, ?, ?, 'linked', 'manual', '', ?, ?, ?, ?)
           ON CONFLICT(interaction_id, target_kind, target_id, origin, rule_id) DO UPDATE SET state = 'linked', collection = excluded.collection, revision = interaction_links.revision + 1, updated_at = excluded.updated_at`,
          newId(), time, time, row.id, target.kind, target.id, collection, row.source_key, row.occurred_at, row.thread_key,
        );
      } else if (input.operation === 'unlink') {
        writable();
        ctx.db.run("DELETE FROM interaction_links WHERE interaction_id = ? AND target_kind = ? AND target_id = ? AND origin = 'manual'", row.id, target.kind, target.id);
      } else {
        const collection = writable(input.collection);
        ctx.db.run("DELETE FROM interaction_links WHERE interaction_id = ? AND target_kind = ? AND target_id = ? AND origin = 'manual'", row.id, target.kind, target.id);
        ctx.db.run(
          `INSERT INTO interaction_links (id, created_at, updated_at, revision, interaction_id, target_kind, target_id, state, origin, rule_id, collection, source_key, occurred_at, thread_key)
           VALUES (?, ?, ?, 1, ?, ?, ?, 'excluded', 'manual', '', ?, ?, ?, ?)
           ON CONFLICT(interaction_id, target_kind, target_id, origin, rule_id) DO UPDATE SET state = 'excluded', revision = interaction_links.revision + 1, updated_at = excluded.updated_at`,
          newId(), time, time, row.id, target.kind, target.id, collection, row.source_key, row.occurred_at, row.thread_key,
        );
      }
      bump();
      if (target.kind === 'organization') { refreshOrganization(ctx, target.id); affected.organizations.push(target.id); }
    }
  }
  for (const person of affected.persons) refreshPerson(ctx, person);
  touch(ctx, row.source_key);
  return { status: 'saved', id: row.id, affected };
}
