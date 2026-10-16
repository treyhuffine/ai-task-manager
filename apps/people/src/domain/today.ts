import type { AccessScope } from '@ri/app-kit/data';
import type { Ctx } from './context.js';
import { Labels, coverageFor } from './coverage.js';
import { listFollowUps } from './commitments.js';
import { factsFor } from './facts.js';
import { lastExchange, personName, personRef, personVisible } from './projection.js';
import { listReviews } from './reviews.js';
import { dataRevision, sourceFilter } from './scope.js';
import type { PersonRow } from './people.js';

/**
 * Today: upcoming meetings, chosen follow-ups, waiting-on items, keep-in-touch
 * reminders the owner chose, and a short sourced review queue. Nothing is
 * manufactured to fill the page.
 */
export function getToday(ctx: Ctx, scope: AccessScope, granted?: ReadonlySet<string> | null) {
  const labels = new Labels(ctx);
  const now = ctx.now(), nowIso = now.toISOString();
  const filter = sourceFilter(scope, 'ip.source_key');
  const meetingRows = ctx.db.all<{ id: string; occurred_at: string; subject: string | null; owner_response: string | null }>(
    `SELECT DISTINCT i.id, i.occurred_at, i.subject, i.owner_response FROM interaction_participants ip JOIN interactions i ON i.id = ip.interaction_id
     WHERE ip.kind = 'meeting' AND ip.active = 1 AND ip.person_id IS NOT NULL AND ip.occurred_at >= ? AND ip.occurred_at < ? AND ${filter.sql}
     ORDER BY i.occurred_at, i.id LIMIT 10`, nowIso, new Date(now.getTime() + 7 * 864e5).toISOString(), ...filter.params);
  const meetings = meetingRows.map((row) => {
    const people = ctx.db.all<{ person_id: string }>(`SELECT DISTINCT ip.person_id FROM interaction_participants ip WHERE ip.interaction_id = ? AND ip.person_id IS NOT NULL AND ${filter.sql} LIMIT 8`, row.id, ...filter.params)
      .map((item) => personRef(ctx, scope, item.person_id)).filter((item): item is { id: string; name: string } => !!item);
    return { id: row.id, at: row.occurred_at, title: row.subject?.trim() || 'Meeting scheduled', people, declined: row.owner_response === 'declined' };
  }).filter((meeting) => meeting.people.length);
  const iOwe = listFollowUps(ctx, scope, { filter: 'i_owe', limit: 8 }, labels).items;
  const waiting = listFollowUps(ctx, scope, { filter: 'waiting_on', limit: 5 }, labels).items;
  const suggestions = listFollowUps(ctx, scope, { filter: 'suggestions', limit: 3 }, labels).items;
  const suggestionCount = Number(ctx.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM commitments WHERE state = 'suggested' AND ${sourceFilter(scope, 'source_key').sql}`, ...sourceFilter(scope, 'source_key').params)?.count ?? 0);
  const factFilter = sourceFilter(scope, 'source_key');
  const factRows = ctx.db.all<{ subject_kind: string; subject_id: string }>(`SELECT DISTINCT subject_kind, subject_id FROM facts WHERE status = 'suggested' AND ${factFilter.sql} ORDER BY observed_at DESC LIMIT 3`, ...factFilter.params);
  const facts = factRows.flatMap((row) => factsFor(ctx, scope, row.subject_kind, row.subject_id, labels, ['suggested']).slice(0, 1));
  const factCount = Number(ctx.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM facts WHERE status = 'suggested' AND ${factFilter.sql}`, ...factFilter.params)?.count ?? 0);
  const reviews = listReviews(ctx, scope, { limit: 3 });
  const keepInTouch = ctx.db.all<PersonRow>('SELECT * FROM persons WHERE keep_in_touch_days IS NOT NULL AND merged_into IS NULL AND archived_at IS NULL ORDER BY COALESCE(last_exchange_at, \'\') LIMIT 50')
    .filter((person) => personVisible(ctx, scope, person.id))
    .map((person) => ({ person, last: lastExchange(ctx, scope, person) }))
    .filter(({ person, last }) => !last || Date.parse(last) < now.getTime() - (person.keep_in_touch_days ?? 0) * 864e5)
    .slice(0, 5)
    .map(({ person, last }) => ({ id: person.id, name: personName(ctx, scope, person), lastExchangeAt: last, intervalDays: person.keep_in_touch_days! }));
  const focus = meetings[0]?.people[0]?.id
    ?? iOwe.map((item) => item.kind === 'commitment' ? item.commitment.person?.id : item.subject?.kind === 'person' ? item.subject.id : null).find(Boolean)
    ?? waiting.map((item) => item.kind === 'commitment' ? item.commitment.person?.id : null).find(Boolean)
    ?? keepInTouch[0]?.id
    ?? (() => { const pinned = ctx.db.all<PersonRow>('SELECT * FROM persons WHERE pinned = 1 AND merged_into IS NULL AND archived_at IS NULL ORDER BY sort_name LIMIT 20').find((person) => personVisible(ctx, scope, person.id)); return pinned?.id; })()
    ?? null;
  return {
    meetings, iOwe, waitingOn: waiting, keepInTouch,
    review: { suggestions, suggestionCount, facts, factCount, identities: reviews.items, identityCount: scope.kind === 'owner' ? Number(ctx.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM identity_reviews WHERE state = 'open'")?.count ?? 0) : listReviews(ctx, scope, { limit: 100 }).items.length },
    focusPersonId: focus ?? null,
    empty: !meetings.length && !iOwe.length && !waiting.length && !keepInTouch.length,
    coverage: coverageFor(ctx, scope, granted),
    revision: dataRevision(ctx, scope),
  };
}
