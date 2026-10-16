import { AppError } from '@ri/app-kit/contract';
import type { AccessScope } from '@ri/app-kit/data';
import type { Ctx } from './context.js';
import { Labels, coverageFor } from './coverage.js';
import { visibleAffiliations } from './affiliations.js';
import { rulesFor } from './attribution.js';
import { commitmentsFor, projectCommitment, type CommitmentRow } from './commitments.js';
import { factsFor } from './facts.js';
import { taskLinksFor } from './followups.js';
import { listTimeline } from './interactions.js';
import { notesFor } from './notes.js';
import { getOrganizationRow, knownPeopleCount, organizationActivity, resolveOrganizationId } from './organizations.js';
import { getPersonRow, resolvePersonId } from './people.js';
import { getOpportunityRow, stageHistory, stagesOf, summarizeOpportunity } from './pipelines.js';
import {
  bestAffiliation, lastExchange, memberLists, monthYear, nextActionFor, nextMeeting, organizationName, organizationVisible, personName, personVisible,
} from './projection.js';
import { listReviews } from './reviews.js';
import { canSee, dataRevision, opportunityFilter, sourceFilter } from './scope.js';
import type { Identity, OrganizationDetail, OpportunityDetail, PersonDetail } from '../schemas.js';

const ORIGIN_LABELS: Record<string, string> = {
  manual: 'Added by you', import: 'From an imported file', sent_mail: 'From mail you sent', reply: 'From a direct reply to your mail',
  meeting: 'From a small meeting with you', incoming: 'Included by you from incoming mail', merge: 'Merged by you',
};

export function identitiesFor(ctx: Ctx, scope: AccessScope, ownerKind: 'person' | 'organization', ownerId: string, labels: Labels): Identity[] {
  const filter = sourceFilter(scope, 'o.source_key');
  const rows = ctx.db.all<{ key_id: string; kind: Identity['kind']; value: string; shared: number; confirmation: Identity['confirmation']; source_key: string; observed_at: string }>(
    `SELECT k.id AS key_id, k.kind, o.value, k.shared, o.confirmation, o.source_key, o.observed_at FROM identity_keys k JOIN identity_observations o ON o.key_id = k.id
     WHERE k.owner_kind = ? AND k.owner_id = ? AND ${filter.sql} ORDER BY k.kind, o.observed_at LIMIT 200`, ownerKind, ownerId, ...filter.params);
  const byKey = new Map<string, Identity>();
  for (const row of rows) {
    const existing = byKey.get(row.key_id);
    if (existing) {
      if (!existing.sources.includes(labels.of(row.source_key))) existing.sources.push(labels.of(row.source_key));
      if (row.confirmation === 'confirmed') existing.confirmation = 'confirmed';
      continue;
    }
    byKey.set(row.key_id, { keyId: row.key_id, kind: row.kind, value: row.value, shared: row.shared === 1, confirmation: row.confirmation, sources: [labels.of(row.source_key)], observedAt: row.observed_at });
  }
  return [...byKey.values()].slice(0, 50);
}

/** Everything about one person that this caller may see. Opening a record starts no import or AI. */
export function getPersonDetail(ctx: Ctx, scope: AccessScope, requestedId: string, granted?: ReadonlySet<string> | null): PersonDetail {
  const id = resolvePersonId(ctx, requestedId);
  const person = getPersonRow(ctx, id);
  if (!person || person.merged_into || !personVisible(ctx, scope, id)) throw new AppError('not_found', 'This person is no longer available');
  const labels = new Labels(ctx);
  const now = ctx.now().toISOString(), today = now.slice(0, 10);
  const affiliation = bestAffiliation(ctx, scope, id, today);
  const affiliationNote = affiliation.row
    ? affiliation.row.confidence === 'confirmed'
      ? affiliation.status === 'former' ? 'Former affiliation recorded by you' : 'Affiliation confirmed by you'
      : `Affiliation observed in ${monthYear(affiliation.row.observed_at)} ${affiliation.row.source_key.startsWith('import:') ? 'import' : 'correspondence'}`
    : 'No company recorded';
  const observedNames = scope.kind === 'owner'
    ? ctx.db.all<{ name: string; source_key: string }>("SELECT name, source_key FROM person_sources WHERE person_id = ? AND name IS NOT NULL AND name_rank = 1 LIMIT 10", id)
    : (() => { const filter = sourceFilter(scope, 'source_key'); return ctx.db.all<{ name: string; source_key: string }>(`SELECT name, source_key FROM person_sources WHERE person_id = ? AND name IS NOT NULL AND name_rank = 1 AND ${filter.sql} LIMIT 10`, id, ...filter.params); })();
  const filter = opportunityFilter(scope, 'o');
  const opportunities = ctx.db.all<{ id: string; title: string; pipeline_id: string; stage_id: string; pipeline: string; label: string; kind: 'open' | 'succeeded' | 'closed' }>(
    `SELECT o.id, o.title, o.pipeline_id, o.stage_id, p.name AS pipeline, s.label, s.kind FROM opportunity_people op JOIN opportunities o ON o.id = op.opportunity_id JOIN pipelines p ON p.id = o.pipeline_id JOIN pipeline_stages s ON s.id = o.stage_id
     WHERE op.person_id = ? AND o.archived_at IS NULL AND ${filter.sql} ORDER BY o.updated_at DESC LIMIT 30`, id, ...filter.params)
    .map((row) => ({ id: row.id, title: row.title, pipelineId: row.pipeline_id, pipelineName: row.pipeline, stageId: row.stage_id, stageLabel: row.label, stageKind: row.kind }));
  const reviews = listReviews(ctx, scope, { recordId: id, limit: 10 }).items.map((item) => ({ id: item.id, kind: item.kind, summary: item.summary.slice(0, 300) }));
  return {
    person: {
      id, revision: person.revision, name: personName(ctx, scope, person), nameOverride: canSee(scope, person.collection) ? person.name_override : null,
      headline: canSee(scope, person.collection) ? person.headline : null,
      observedNames: observedNames.map((row) => ({ name: row.name, sourceLabel: labels.of(row.source_key) })),
      collection: person.collection as PersonDetail['person']['collection'], origin: person.origin, originLabel: ORIGIN_LABELS[person.origin] ?? 'Saved record',
      pinned: person.pinned === 1, archived: !!person.archived_at, keepInTouchDays: person.keep_in_touch_days, createdAt: person.created_at, updatedAt: person.updated_at,
    },
    header: { role: affiliation.role ?? (canSee(scope, person.collection) ? person.headline : null), company: affiliation.company, affiliationNote, lastExchangeAt: lastExchange(ctx, scope, person), nextMeeting: nextMeeting(ctx, scope, id, now), nextAction: nextActionFor(ctx, scope, { kind: 'person', id }, today) },
    identities: identitiesFor(ctx, scope, 'person', id, labels),
    affiliations: visibleAffiliations(ctx, scope, 'person_id', id, labels, { includeSuggested: true, limit: 50 }),
    notes: notesFor(ctx, scope, 'person', id, labels),
    commitments: commitmentsFor(ctx, scope, 'person_id', id, labels),
    facts: factsFor(ctx, scope, 'person', id, labels),
    taskLinks: taskLinksFor(ctx, scope, 'person', id),
    opportunities,
    lists: memberLists(ctx, scope, id),
    reviews,
    attribution: rulesFor(ctx, scope, 'person_id', id, labels).flatMap((rule) => rule.organization ? [{ id: rule.id, revision: rule.revision, organization: rule.organization, identity: rule.identity, account: rule.account, from: rule.from, to: rule.to, state: rule.state }] : []),
    coverage: coverageFor(ctx, scope, granted),
    revision: dataRevision(ctx, scope),
  };
}

export function getOrganizationDetail(ctx: Ctx, scope: AccessScope, requestedId: string, granted?: ReadonlySet<string> | null): OrganizationDetail {
  const id = resolveOrganizationId(ctx, requestedId);
  const organization = getOrganizationRow(ctx, id);
  if (!organization || organization.merged_into || !organizationVisible(ctx, scope, id)) throw new AppError('not_found', 'This company is no longer available');
  const labels = new Labels(ctx);
  const today = ctx.now().toISOString().slice(0, 10);
  const affiliations = visibleAffiliations(ctx, scope, 'organization_id', id, labels, { limit: 301 });
  const people = { current: [] as typeof affiliations, former: [] as typeof affiliations, uncertain: [] as typeof affiliations, more: affiliations.length > 300 };
  for (const item of affiliations.slice(0, 300)) {
    if (item.status === 'former') people.former.push(item);
    else if (item.status === 'current' && item.confidence === 'confirmed') people.current.push(item);
    else people.uncertain.push(item);
  }
  const domains = (() => {
    const filter = sourceFilter(scope, 'source_key');
    return ctx.db.all<{ domain: string; source_key: string; confirmation: 'confirmed' | 'observed'; created_at: string }>(`SELECT domain, source_key, confirmation, created_at FROM organization_domains WHERE organization_id = ? AND ${filter.sql} ORDER BY confirmation = 'confirmed' DESC LIMIT 30`, id, ...filter.params)
      .map((row) => ({ keyId: `${id}:${row.domain}`, kind: 'domain' as const, value: row.domain, shared: false, confirmation: row.confirmation, sources: [labels.of(row.source_key)], observedAt: row.created_at }));
  })();
  const contact = identitiesFor(ctx, scope, 'organization', id, labels);
  const filter = opportunityFilter(scope, 'o');
  const opportunities = ctx.db.all<{ id: string; title: string; label: string; kind: 'open' | 'succeeded' | 'closed'; pipeline: string; next_action: string | null; next_action_date: string | null; value_minor: number | null; currency: string | null }>(
    `SELECT o.id, o.title, s.label, s.kind, p.name AS pipeline, o.next_action, o.next_action_date, o.value_minor, o.currency FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id JOIN pipelines p ON p.id = o.pipeline_id
     WHERE o.organization_id = ? AND o.archived_at IS NULL AND ${filter.sql} ORDER BY s.kind = 'open' DESC, COALESCE(o.next_action_date, '9999') LIMIT 50`, id, ...filter.params)
    .map((row) => ({ id: row.id, title: row.title, stageLabel: row.label, stageKind: row.kind, pipelineName: row.pipeline, nextAction: row.next_action, nextActionDate: row.next_action_date, value: row.value_minor !== null && row.currency ? { minor: row.value_minor, currency: row.currency } : null }));
  const stateLabel = organization.state === 'confirmed' ? (organization.origin === 'manual' ? 'Company details added by you' : 'Company details confirmed by you') : 'Provisional company from an import. Confirm it when it looks right';
  return {
    organization: {
      id, revision: organization.revision, name: organizationName(ctx, scope, organization), nameOverride: canSee(scope, organization.collection) ? organization.name_override : null,
      kind: (organization.kind as OrganizationDetail['organization']['kind']) ?? null, website: canSee(scope, organization.collection) ? organization.website : null,
      state: organization.state as 'provisional' | 'confirmed', stateLabel, collection: organization.collection as OrganizationDetail['organization']['collection'],
      archived: !!organization.archived_at, createdAt: organization.created_at, updatedAt: organization.updated_at,
    },
    domains: [...domains, ...contact].slice(0, 30),
    people,
    nextAction: nextActionFor(ctx, scope, { kind: 'organization', id }, today),
    commitments: companyCommitments(ctx, scope, id, labels),
    opportunities,
    notes: notesFor(ctx, scope, 'organization', id, labels),
    taskLinks: taskLinksFor(ctx, scope, 'organization', id),
    lists: memberLists(ctx, scope, id),
    attributionRules: rulesFor(ctx, scope, 'organization_id', id, labels).map(({ organization: _organization, ...rule }) => rule),
    lastExchangeAt: organizationActivity(ctx, scope, organization),
    coverage: coverageFor(ctx, scope, granted),
    revision: dataRevision(ctx, scope),
  };
}

/**
 * Commitments that belong to a company: those recorded against it, and those
 * from conversations explicitly linked or attributed to it. A person's
 * unrelated exchanges never become company commitments.
 */
export function companyCommitments(ctx: Ctx, scope: AccessScope, organizationId: string, labels: Labels) {
  const c = sourceFilter(scope, 'c.source_key'), l = sourceFilter(scope, 'l.source_key'), lc = sourceFilter(scope, 'l.collection');
  const rows = ctx.db.all<CommitmentRow>(
    `SELECT c.* FROM commitments c WHERE c.state IN ('suggested','accepted') AND ${c.sql} AND (c.organization_id = ? OR c.interaction_id IN (
       SELECT l.interaction_id FROM interaction_links l WHERE l.target_kind = 'organization' AND l.target_id = ? AND l.state = 'linked' AND ${l.sql} AND ${lc.sql}
       AND NOT EXISTS (SELECT 1 FROM interaction_links x WHERE x.interaction_id = l.interaction_id AND x.target_id = l.target_id AND x.state = 'excluded')))
     ORDER BY c.state = 'accepted' DESC, COALESCE(c.due_date, '9999'), c.created_at DESC LIMIT 30`,
    ...c.params, organizationId, organizationId, ...l.params, ...lc.params);
  return rows.map((row) => projectCommitment(ctx, scope, row, labels)).filter((item): item is NonNullable<typeof item> => !!item);
}

export function getOpportunityDetail(ctx: Ctx, scope: AccessScope, id: string): OpportunityDetail {
  const row = getOpportunityRow(ctx, scope, id);
  if (!row) throw new AppError('not_found', 'This opportunity is no longer available');
  const labels = new Labels(ctx);
  const pipeline = ctx.db.get<{ name: string }>('SELECT name FROM pipelines WHERE id = ?', row.pipeline_id);
  const summary = summarizeOpportunity(ctx, scope, row);
  const counts = new Map<string, number>();
  const filter = opportunityFilter(scope, 'o');
  for (const item of ctx.db.all<{ stage_id: string; count: number }>(`SELECT o.stage_id, COUNT(*) AS count FROM opportunities o WHERE o.pipeline_id = ? AND o.archived_at IS NULL AND ${filter.sql} GROUP BY o.stage_id`, row.pipeline_id, ...filter.params)) counts.set(item.stage_id, Number(item.count));
  return {
    opportunity: { ...summary, collection: row.collection as OpportunityDetail['opportunity']['collection'], pipelineName: pipeline?.name ?? 'Pipeline' },
    stages: stagesOf(ctx, row.pipeline_id).map((stage, index) => ({ id: stage.id, label: stage.label, kind: stage.kind, position: index, count: counts.get(stage.id) ?? 0 })),
    history: stageHistory(ctx, scope, row.id),
    notes: notesFor(ctx, scope, 'opportunity', row.id, labels),
    suggestions: factsFor(ctx, scope, 'opportunity', row.id, labels, ['suggested']),
    activity: listTimeline(ctx, scope, { subject: { kind: 'opportunity', id: row.id }, limit: 20, include: ['email', 'meeting'] }).items,
    revision: dataRevision(ctx, scope),
  };
}

export { knownPeopleCount };
