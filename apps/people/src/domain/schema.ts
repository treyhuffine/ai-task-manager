import type { Migration } from '@ri/app-kit/data';

/**
 * Forward-only migrations. Once a migration ships it is immutable: add a new
 * one instead of editing it. Every table has an immutable `id` and
 * `created_at` / `updated_at`. Mutable records carry `revision`. Policy values
 * (initial states, kinds, defaults) come from the query layer, never from SQL
 * defaults, so changing a policy never needs a table rebuild.
 *
 * Source keys decide who may read a row: `account:<connection>` for anything
 * imported from a connected account, `manual` or `collection:<id>` for the
 * owner's explicit collections, and `import:<id>` for a file import.
 */
const V1 = `
CREATE TABLE app_revisions (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL
);

CREATE TABLE collections (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  source_key TEXT NOT NULL UNIQUE, label TEXT NOT NULL, archived_at TEXT
);

CREATE TABLE persons (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  collection TEXT NOT NULL, origin TEXT NOT NULL,
  name_override TEXT, display_name TEXT NOT NULL, sort_name TEXT NOT NULL, name_source TEXT, headline TEXT,
  pinned INTEGER NOT NULL, archived_at TEXT, keep_in_touch_days INTEGER,
  last_exchange_at TEXT, merged_into TEXT, merged_at TEXT
);
CREATE INDEX persons_name ON persons (merged_into, archived_at, sort_name, id);
CREATE INDEX persons_exchange ON persons (merged_into, archived_at, last_exchange_at, id);
CREATE INDEX persons_added ON persons (merged_into, archived_at, created_at, id);
CREATE INDEX persons_pinned ON persons (pinned, merged_into, archived_at);

CREATE TABLE person_sources (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  person_id TEXT NOT NULL, source_key TEXT NOT NULL,
  name TEXT, sort_name TEXT, name_rank INTEGER, name_at TEXT, last_exchange_at TEXT, last_seen_at TEXT,
  UNIQUE (person_id, source_key)
);
CREATE INDEX person_sources_source ON person_sources (source_key, person_id);

CREATE TABLE organizations (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  collection TEXT NOT NULL, origin TEXT NOT NULL,
  name_override TEXT, display_name TEXT NOT NULL, sort_name TEXT NOT NULL, name_source TEXT,
  kind TEXT, website TEXT, state TEXT NOT NULL CHECK (state IN ('provisional','confirmed')),
  archived_at TEXT, last_activity_at TEXT, merged_into TEXT, merged_at TEXT
);
CREATE INDEX organizations_name ON organizations (merged_into, archived_at, sort_name, id);
CREATE INDEX organizations_activity ON organizations (merged_into, archived_at, last_activity_at, id);
CREATE INDEX organizations_added ON organizations (merged_into, archived_at, created_at, id);

CREATE TABLE organization_sources (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  organization_id TEXT NOT NULL, source_key TEXT NOT NULL,
  name TEXT, sort_name TEXT, name_rank INTEGER, name_at TEXT, last_seen_at TEXT,
  UNIQUE (organization_id, source_key)
);
CREATE INDEX organization_sources_source ON organization_sources (source_key, organization_id);

-- Domains are evidence for an organization, not exclusive keys: two organizations may share one.
CREATE TABLE organization_domains (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  organization_id TEXT NOT NULL, domain TEXT NOT NULL, source_key TEXT NOT NULL,
  confirmation TEXT NOT NULL CHECK (confirmation IN ('confirmed','observed')), evidence_id TEXT,
  UNIQUE (organization_id, domain, source_key)
);
CREATE INDEX organization_domains_domain ON organization_domains (domain);

-- One row per normalized identifier. Its owner is the decision, observations are evidence.
CREATE TABLE identity_keys (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('email','domain','phone','linkedin','website')),
  normalized TEXT NOT NULL,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('person','organization','none')), owner_id TEXT,
  shared INTEGER NOT NULL, decision TEXT NOT NULL CHECK (decision IN ('auto','user')),
  UNIQUE (kind, normalized)
);
CREATE INDEX identity_keys_owner ON identity_keys (owner_kind, owner_id);

CREATE TABLE identity_observations (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  key_id TEXT NOT NULL, source_key TEXT NOT NULL, value TEXT NOT NULL, observed_name TEXT,
  observed_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, evidence_id TEXT,
  confirmation TEXT NOT NULL CHECK (confirmation IN ('confirmed','observed')),
  UNIQUE (key_id, source_key)
);
CREATE INDEX identity_observations_source ON identity_observations (source_key);

CREATE TABLE affiliations (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  person_id TEXT NOT NULL, organization_id TEXT NOT NULL, role TEXT,
  valid_from TEXT, valid_to TEXT, observed_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('current','former','unknown')),
  confidence TEXT NOT NULL CHECK (confidence IN ('confirmed','observed','suggested')),
  source_key TEXT NOT NULL, origin TEXT NOT NULL, evidence_id TEXT,
  decision TEXT CHECK (decision IN ('confirmed','rejected')), decision_key TEXT
);
CREATE INDEX affiliations_person ON affiliations (person_id, confidence);
CREATE INDEX affiliations_org ON affiliations (organization_id, confidence);
CREATE INDEX affiliations_source ON affiliations (source_key);
CREATE INDEX affiliations_decision ON affiliations (decision_key);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  source_key TEXT NOT NULL, interaction_id TEXT, kind TEXT NOT NULL,
  blob_digest TEXT, excerpt TEXT, source_date TEXT, title TEXT, participants TEXT NOT NULL,
  link TEXT, source_revision TEXT, status TEXT NOT NULL CHECK (status IN ('available','unavailable','deleted'))
);
CREATE INDEX evidence_interaction ON evidence (interaction_id);
CREATE INDEX evidence_source ON evidence (source_key);

CREATE TABLE interactions (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  source_key TEXT NOT NULL, provider TEXT NOT NULL, external_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('email','meeting')),
  occurred_at TEXT NOT NULL, ends_at TEXT, subject TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('sent','received','meeting')),
  thread_key TEXT, message_id_header TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','cancelled','unavailable')),
  excluded_reason TEXT, included INTEGER NOT NULL, participant_count INTEGER NOT NULL,
  evidence_id TEXT, digest TEXT,
  attendance TEXT NOT NULL CHECK (attendance IN ('unknown','confirmed','not_attended')),
  owner_response TEXT, time_zone TEXT, recurring_key TEXT, link TEXT,
  UNIQUE (source_key, external_id)
);
CREATE INDEX interactions_time ON interactions (occurred_at, id);
CREATE INDEX interactions_thread ON interactions (source_key, thread_key, occurred_at);
CREATE INDEX interactions_message_id ON interactions (message_id_header);
CREATE INDEX interactions_excluded ON interactions (excluded_reason, included);

CREATE TABLE interaction_participants (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  interaction_id TEXT NOT NULL, key_id TEXT NOT NULL, person_id TEXT,
  role TEXT NOT NULL, source_key TEXT NOT NULL, occurred_at TEXT NOT NULL,
  kind TEXT NOT NULL, direct INTEGER NOT NULL, active INTEGER NOT NULL,
  UNIQUE (interaction_id, key_id)
);
CREATE INDEX participants_person ON interaction_participants (person_id, occurred_at);
CREATE INDEX participants_person_source ON interaction_participants (person_id, source_key, direct, occurred_at);
CREATE INDEX participants_key ON interaction_participants (key_id);
CREATE INDEX participants_meetings ON interaction_participants (kind, active, occurred_at);

CREATE TABLE interaction_links (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  interaction_id TEXT NOT NULL, target_kind TEXT NOT NULL CHECK (target_kind IN ('organization','opportunity')),
  target_id TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('linked','excluded')),
  origin TEXT NOT NULL CHECK (origin IN ('manual','rule')), rule_id TEXT NOT NULL,
  collection TEXT NOT NULL, source_key TEXT NOT NULL, occurred_at TEXT NOT NULL, thread_key TEXT,
  UNIQUE (interaction_id, target_kind, target_id, origin, rule_id)
);
CREATE INDEX interaction_links_target ON interaction_links (target_kind, target_id, state, occurred_at);
CREATE INDEX interaction_links_rule ON interaction_links (rule_id);

CREATE TABLE attribution_rules (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  account_source TEXT NOT NULL, key_id TEXT NOT NULL, person_id TEXT, organization_id TEXT NOT NULL,
  effective_from TEXT, effective_to TEXT, state TEXT NOT NULL CHECK (state IN ('active','disabled')),
  collection TEXT NOT NULL, decided_by TEXT NOT NULL, pending INTEGER NOT NULL
);
CREATE INDEX attribution_rules_key ON attribution_rules (key_id, state);

CREATE TABLE previews (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  kind TEXT NOT NULL, expires_at TEXT NOT NULL, digest TEXT NOT NULL,
  payload TEXT NOT NULL, applied_at TEXT, result TEXT
);

CREATE TABLE imports (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE, preview_id TEXT NOT NULL UNIQUE, format TEXT NOT NULL,
  file_name TEXT NOT NULL, file_digest TEXT NOT NULL, label TEXT NOT NULL, counts TEXT NOT NULL,
  collection TEXT NOT NULL
);
CREATE INDEX imports_digest ON imports (file_digest);

CREATE TABLE import_rows (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  import_id TEXT NOT NULL, source_key TEXT NOT NULL, row_key TEXT NOT NULL, row_digest TEXT NOT NULL,
  name TEXT, org_name TEXT, person_id TEXT, organization_id TEXT, raw TEXT NOT NULL
);
CREATE INDEX import_rows_key ON import_rows (row_key, row_digest);
CREATE INDEX import_rows_source ON import_rows (source_key);
CREATE INDEX import_rows_person ON import_rows (person_id);
CREATE INDEX import_rows_org ON import_rows (organization_id);

CREATE TABLE notes (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('person','organization','opportunity')),
  subject_id TEXT NOT NULL, title TEXT, body TEXT NOT NULL, collection TEXT NOT NULL, archived_at TEXT
);
CREATE INDEX notes_subject ON notes (subject_kind, subject_id, updated_at);

CREATE TABLE facts (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, field TEXT NOT NULL, claim_key TEXT NOT NULL,
  value TEXT NOT NULL, detail TEXT, user_value TEXT, evidence_id TEXT, source_key TEXT NOT NULL, source_revision TEXT,
  passage TEXT, observed_at TEXT NOT NULL, effective_from TEXT, effective_to TEXT,
  extraction_version TEXT NOT NULL, origin TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('suggested','active','superseded','withdrawn','rejected')),
  decision_key TEXT NOT NULL, decided_at TEXT, decided_by TEXT, resolution TEXT, previous_decision TEXT
);
CREATE INDEX facts_subject ON facts (subject_kind, subject_id, status);
CREATE INDEX facts_status ON facts (status, observed_at);
CREATE INDEX facts_decision ON facts (decision_key);
CREATE INDEX facts_source ON facts (source_key);

-- Durable user decisions keyed by source and claim. They outlive the records they judged.
CREATE TABLE decisions (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  decision_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL,
  decision TEXT NOT NULL, extracted_value TEXT, user_value TEXT, fingerprint TEXT, actor TEXT NOT NULL, item_key TEXT
);
CREATE INDEX decisions_subject ON decisions (subject_kind, subject_id, kind);
CREATE INDEX decisions_item ON decisions (item_key);

CREATE TABLE commitments (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  person_id TEXT, organization_id TEXT, opportunity_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('i_owe','waiting_on')),
  actor_label TEXT NOT NULL, recipient_label TEXT NOT NULL, action TEXT NOT NULL, due_date TEXT,
  extracted_action TEXT, extracted_due_date TEXT,
  evidence_id TEXT, interaction_id TEXT, source_key TEXT NOT NULL, passage TEXT,
  state TEXT NOT NULL CHECK (state IN ('suggested','accepted','dismissed','completed','withdrawn')),
  origin TEXT NOT NULL CHECK (origin IN ('extracted','manual')),
  snoozed_until TEXT, decision_key TEXT, extraction_version TEXT,
  completion_evidence_id TEXT, resolution TEXT, task_link_id TEXT, previous_decision TEXT, anchor TEXT
);
CREATE INDEX commitments_state ON commitments (state, direction, due_date);
CREATE INDEX commitments_person ON commitments (person_id, state);
CREATE INDEX commitments_org ON commitments (organization_id, state);
CREATE INDEX commitments_source ON commitments (source_key);
CREATE INDEX commitments_decision ON commitments (decision_key);
CREATE INDEX commitments_interaction ON commitments (interaction_id);

CREATE TABLE commitment_history (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  commitment_id TEXT NOT NULL, from_state TEXT, to_state TEXT NOT NULL, actor TEXT NOT NULL,
  note TEXT, evidence_id TEXT
);
CREATE INDEX commitment_history_commitment ON commitment_history (commitment_id, created_at);

CREATE TABLE task_links (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('commitment','person','organization','opportunity')),
  subject_id TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, due_at TEXT,
  collection TEXT NOT NULL, task_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','linked','unavailable','failed')),
  task_status TEXT, last_error TEXT, last_checked_at TEXT
);
CREATE INDEX task_links_subject ON task_links (subject_kind, subject_id);
CREATE INDEX task_links_status ON task_links (status, due_at);

CREATE TABLE lists (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  name TEXT NOT NULL, record_kind TEXT NOT NULL CHECK (record_kind IN ('person','organization')),
  collection TEXT NOT NULL, archived_at TEXT
);
CREATE TABLE list_members (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  list_id TEXT NOT NULL, member_id TEXT NOT NULL, position INTEGER NOT NULL, added_by TEXT NOT NULL,
  UNIQUE (list_id, member_id)
);
CREATE INDEX list_members_member ON list_members (member_id);
CREATE INDEX list_members_order ON list_members (list_id, position);

CREATE TABLE saved_views (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  label TEXT NOT NULL, record_kind TEXT NOT NULL CHECK (record_kind IN ('person','organization','opportunity')),
  filters TEXT NOT NULL, sort TEXT NOT NULL, columns TEXT NOT NULL, list_id TEXT, pipeline_id TEXT,
  navigation TEXT NOT NULL CHECK (navigation IN ('picker','pinned')), collection TEXT NOT NULL, archived_at TEXT
);

CREATE TABLE pipelines (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  name TEXT NOT NULL, template TEXT NOT NULL, collection TEXT NOT NULL, archived_at TEXT
);
CREATE TABLE pipeline_stages (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  pipeline_id TEXT NOT NULL, label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('open','succeeded','closed')), position INTEGER NOT NULL, archived_at TEXT
);
CREATE INDEX pipeline_stages_order ON pipeline_stages (pipeline_id, archived_at, position);

CREATE TABLE opportunities (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  title TEXT NOT NULL, pipeline_id TEXT NOT NULL, stage_id TEXT NOT NULL, organization_id TEXT,
  target_date TEXT, value_minor INTEGER, currency TEXT, next_action TEXT, next_action_date TEXT,
  task_link_id TEXT, collection TEXT NOT NULL, archived_at TEXT, closed_at TEXT,
  CHECK ((value_minor IS NULL) = (currency IS NULL))
);
CREATE INDEX opportunities_stage ON opportunities (pipeline_id, stage_id, archived_at);
CREATE INDEX opportunities_org ON opportunities (organization_id);

CREATE TABLE opportunity_people (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  opportunity_id TEXT NOT NULL, person_id TEXT NOT NULL,
  UNIQUE (opportunity_id, person_id)
);
CREATE INDEX opportunity_people_person ON opportunity_people (person_id);

CREATE TABLE stage_changes (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  opportunity_id TEXT NOT NULL, from_pipeline_id TEXT, from_stage_id TEXT,
  to_pipeline_id TEXT NOT NULL, to_stage_id TEXT NOT NULL, actor TEXT NOT NULL,
  mutation_id TEXT NOT NULL, suggestion_id TEXT, evidence_id TEXT, reason TEXT
);
CREATE INDEX stage_changes_opportunity ON stage_changes (opportunity_id, created_at);

CREATE TABLE identity_reviews (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('person','organization','alias','sender')),
  left_id TEXT NOT NULL, right_id TEXT, key_id TEXT, pair_key TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL, evidence TEXT NOT NULL, source_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open','merged','kept_separate','accepted','rejected')),
  decided_at TEXT, decided_by TEXT, merge_id TEXT
);
CREATE INDEX identity_reviews_state ON identity_reviews (state, created_at);

CREATE TABLE merges (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('person','organization')),
  survivor_id TEXT NOT NULL, merged_id TEXT NOT NULL, moves TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('applied','undone')), actor TEXT NOT NULL,
  undone_at TEXT, attributions TEXT
);
CREATE INDEX merges_records ON merges (survivor_id, state);

CREATE TABLE id_mappings (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL, merge_id TEXT NOT NULL, active INTEGER NOT NULL
);
CREATE INDEX id_mappings_from ON id_mappings (from_id, active);

CREATE TABLE exclusions (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sender','domain')), normalized TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('auto','excluded','included','suppressed')),
  reason TEXT NOT NULL, seen_count INTEGER NOT NULL, last_seen_at TEXT, source_key TEXT,
  UNIQUE (kind, normalized)
);
CREATE INDEX exclusions_decision ON exclusions (decision, last_seen_at);

CREATE TABLE briefings (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, meeting_id TEXT NOT NULL,
  scope_fingerprint TEXT NOT NULL, evidence_key TEXT NOT NULL, evidence TEXT NOT NULL,
  content TEXT NOT NULL, generated_at TEXT NOT NULL, extraction_version TEXT NOT NULL,
  UNIQUE (subject_kind, subject_id, meeting_id, scope_fingerprint)
);
CREATE INDEX briefings_subject ON briefings (subject_kind, subject_id);

-- Bounded deferred work: extraction, briefings and attribution linking.
CREATE TABLE work_items (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('extract','briefing','attribute')),
  source_key TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending','done','failed','cancelled')),
  attempts INTEGER NOT NULL, priority TEXT NOT NULL, payload TEXT NOT NULL, last_error TEXT
);
CREATE INDEX work_items_due ON work_items (kind, state, source_key, priority);

CREATE TABLE search_rows (
  id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  ref_key TEXT NOT NULL UNIQUE, record_kind TEXT NOT NULL, record_id TEXT NOT NULL, source_key TEXT NOT NULL
);
CREATE INDEX search_rows_record ON search_rows (record_kind, record_id);
CREATE INDEX search_rows_source ON search_rows (source_key, record_kind);
CREATE VIRTUAL TABLE search_fts USING fts5(text, tokenize='unicode61 remove_diacritics 2');
`;

/**
 * V2: a generated briefing records the sources it was generated from (NULL for
 * the owner's full scope), so a briefing a schedule generated from its own
 * accounts can be shown to any reader who may see all of those sources.
 */
const V2 = `ALTER TABLE briefings ADD COLUMN scope_sources TEXT;`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'people_records', sql: V1 },
  { version: 2, name: 'briefing_scope_sources', sql: V2 },
];
