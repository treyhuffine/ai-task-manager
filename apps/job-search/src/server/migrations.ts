/**
 * Forward-only schema. Applied migrations are immutable: add a new numbered
 * migration for every later change. Policy defaults (initial stage, history
 * range, statuses) come from the query layer, never from SQL defaults.
 */
import type { Migration } from '@ri/app-kit/data';

const V1 = `
CREATE TABLE opportunities (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  company TEXT NOT NULL,
  company_key TEXT NOT NULL,
  role TEXT NOT NULL,
  role_key TEXT NOT NULL,
  location TEXT,
  work_arrangement TEXT CHECK (work_arrangement IN ('onsite','hybrid','remote')),
  source_url TEXT,
  requisition_id TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('saved','applied','interviewing','offer','closed')),
  outcome TEXT CHECK (outcome IN ('rejected','withdrawn','accepted')),
  stage_lock TEXT,
  next_action TEXT,
  next_action_due TEXT,
  deadline TEXT,
  deadline_label TEXT,
  compensation TEXT NOT NULL,
  contacts TEXT NOT NULL,
  company_domains TEXT NOT NULL,
  notes TEXT,
  listing_closed_at TEXT,
  archived_at TEXT,
  created_by TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  fictional INTEGER NOT NULL
);
CREATE INDEX opportunities_company ON opportunities (company_key);
CREATE INDEX opportunities_stage ON opportunities (stage, archived_at);

CREATE TABLE stage_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_stage TEXT,
  from_outcome TEXT,
  to_stage TEXT NOT NULL,
  to_outcome TEXT,
  occurred_at TEXT NOT NULL,
  author TEXT NOT NULL,
  source_key TEXT NOT NULL,
  evidence_kind TEXT,
  evidence_id TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('user','exact','strong','probable','ai')),
  decision TEXT NOT NULL CHECK (decision IN ('applied','suggested','suppressed','dismissed','accepted')),
  revision INTEGER NOT NULL,
  note TEXT,
  dedupe_key TEXT UNIQUE
);
CREATE INDEX stage_events_opportunity ON stage_events (opportunity_id, created_at);

CREATE TABLE posting_snapshots (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('paste','file','import')),
  source_url TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_digest TEXT,
  content_digest TEXT NOT NULL,
  text_digest TEXT NOT NULL,
  characters INTEGER NOT NULL,
  truncated INTEGER NOT NULL,
  extracted TEXT NOT NULL,
  source_key TEXT NOT NULL,
  author TEXT NOT NULL,
  UNIQUE (opportunity_id, content_digest)
);
CREATE TRIGGER posting_snapshots_immutable BEFORE UPDATE ON posting_snapshots
BEGIN SELECT RAISE(ABORT, 'Posting snapshots are immutable'); END;

CREATE TABLE correspondence (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  account TEXT NOT NULL,
  message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  rfc_message_id TEXT,
  in_reply_to TEXT,
  refs TEXT NOT NULL,
  subject TEXT NOT NULL,
  from_json TEXT,
  to_json TEXT NOT NULL,
  sent INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  evidence TEXT NOT NULL,
  body_digest TEXT,
  payload_digest TEXT NOT NULL,
  extraction_version INTEGER NOT NULL,
  classification TEXT NOT NULL,
  classification_passage TEXT,
  signals TEXT NOT NULL,
  invite_uid TEXT,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  match_status TEXT NOT NULL CHECK (match_status IN ('matched','review','unmatched','ignored')),
  match_level TEXT,
  match_basis TEXT NOT NULL,
  matched_by TEXT,
  review_id TEXT,
  ai_label TEXT,
  enrich_state TEXT NOT NULL CHECK (enrich_state IN ('none','pending','done','unavailable','invalid')),
  unavailable_at TEXT,
  UNIQUE (account, message_id)
);
CREATE INDEX correspondence_thread ON correspondence (account, thread_id);
CREATE INDEX correspondence_opportunity ON correspondence (opportunity_id, received_at);
CREATE INDEX correspondence_rfc ON correspondence (rfc_message_id);
CREATE INDEX correspondence_enrich ON correspondence (enrich_state, account);

CREATE TABLE interviews (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('manual','calendar','mail')),
  account TEXT,
  calendar_id TEXT,
  event_key TEXT,
  ical_uid TEXT,
  mail_thread TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduling_needed','scheduled','canceled','completed')),
  start_at TEXT,
  end_at TEXT,
  zone TEXT,
  all_day INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('video','phone','onsite','unknown')),
  location TEXT,
  meeting_link TEXT,
  participants TEXT NOT NULL,
  source_values TEXT NOT NULL,
  overrides TEXT NOT NULL,
  source_state TEXT NOT NULL CHECK (source_state IN ('current','removed','none')),
  match_basis TEXT NOT NULL,
  notes TEXT,
  source_updated_at TEXT,
  UNIQUE (account, calendar_id, event_key)
);
CREATE INDEX interviews_opportunity ON interviews (opportunity_id, start_at);
CREATE INDEX interviews_uid ON interviews (ical_uid);

CREATE TABLE interview_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  occurred_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  source_key TEXT NOT NULL,
  author TEXT NOT NULL,
  evidence_id TEXT
);
CREATE INDEX interview_events_interview ON interview_events (interview_id, occurred_at);

CREATE TABLE material_families (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('resume','cover_letter','portfolio','writing_sample','other')),
  title TEXT NOT NULL,
  archived_at TEXT,
  created_by TEXT NOT NULL,
  fictional INTEGER NOT NULL
);

CREATE TABLE material_versions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  family_id TEXT NOT NULL REFERENCES material_families(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  parent_id TEXT REFERENCES material_versions(id),
  title TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('original','edited')),
  content_digest TEXT NOT NULL,
  text_digest TEXT NOT NULL,
  characters INTEGER NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  file_digest TEXT,
  author TEXT NOT NULL,
  note TEXT,
  UNIQUE (family_id, number)
);
CREATE TRIGGER material_versions_immutable BEFORE UPDATE ON material_versions
BEGIN SELECT RAISE(ABORT, 'Material versions are immutable. Save a new version instead'); END;

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  applied_on TEXT NOT NULL,
  channel TEXT NOT NULL,
  evidence_id TEXT,
  confirmed_by_user INTEGER NOT NULL,
  note TEXT,
  source_key TEXT NOT NULL,
  author TEXT NOT NULL
);
CREATE INDEX submissions_opportunity ON submissions (opportunity_id);

CREATE TABLE submission_materials (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES material_versions(id),
  UNIQUE (submission_id, version_id)
);
CREATE INDEX submission_materials_version ON submission_materials (version_id);
CREATE TRIGGER submission_materials_immutable BEFORE UPDATE ON submission_materials
BEGIN SELECT RAISE(ABORT, 'A recorded submission keeps the exact versions it used'); END;

CREATE TABLE preparations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  interview_id TEXT REFERENCES interviews(id) ON DELETE SET NULL,
  posting_snapshot_id TEXT REFERENCES posting_snapshots(id) ON DELETE SET NULL,
  requirements TEXT NOT NULL,
  examples TEXT NOT NULL,
  questions TEXT NOT NULL,
  notes TEXT NOT NULL,
  suggestions TEXT NOT NULL,
  suggestions_state TEXT NOT NULL,
  author TEXT NOT NULL
);
CREATE UNIQUE INDEX preparations_interview ON preparations (interview_id) WHERE interview_id IS NOT NULL;
CREATE INDEX preparations_opportunity ON preparations (opportunity_id);

CREATE TABLE preparation_revisions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  preparation_id TEXT NOT NULL REFERENCES preparations(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  UNIQUE (preparation_id, revision)
);

CREATE TABLE review_items (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('match','new_opportunity','stage')),
  group_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','resolved','ignored')),
  source_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  candidates TEXT NOT NULL,
  evidence_ids TEXT NOT NULL,
  proposal TEXT NOT NULL,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  decision TEXT,
  decided_by TEXT,
  decided_at TEXT
);
CREATE UNIQUE INDEX review_items_open_group ON review_items (group_key) WHERE status = 'open';
CREATE INDEX review_items_status ON review_items (status, updated_at);

CREATE TABLE follow_up_links (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  interview_id TEXT REFERENCES interviews(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  due_at TEXT,
  task_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','created','failed')),
  last_error TEXT,
  created_by TEXT NOT NULL,
  source_key TEXT NOT NULL
);

CREATE TABLE import_previews (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('posting','material','opportunities')),
  digest TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  summary TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  applied_at TEXT,
  result TEXT,
  author TEXT NOT NULL
);
`;

export const MIGRATIONS: Migration[] = [{ version: 1, name: 'job search records', sql: V1 }];
