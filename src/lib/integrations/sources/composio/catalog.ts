/**
 * The reviewed Composio catalog (docs/connector-service-spec.md §4). Only these actions reach a
 * model, each with Ri's own risk classification: Composio's tool list is not a permission. Adding
 * an action means reviewing its semantics here and accepting it against a real account.
 *
 * Risk follows Ri's approval rule: reads run, internal and reversible writes run on standing
 * intent, and anything outward (mail sent, invitations delivered) asks first.
 */
import { createHash } from 'node:crypto';
import type { RiskLevel } from '@integrations/engine';
import type { ApplicationId } from '../types';

export interface CatalogAction {
  /** The Composio tool slug. */
  slug: string;
  /** Ri's action name, the part after the toolkit in `gmail.send_email`. A public contract. */
  op: string;
  mutating: boolean;
  risk: RiskLevel;
  /** One line Ri adds in front of the vendor description. */
  summary: string;
}

export interface CatalogApplication {
  toolkitSlug: string;
  actions: CatalogAction[];
  /** The pinned read that verifies which provider account a connection is. */
  identity: { slug: string; arguments: Record<string, unknown> };
}

/**
 * The dated toolkit version Ri's typed reads (identity, Calendar view) use. Typed reads parse the
 * output, so they never follow `latest` (spec §9). A retired version makes those reads unavailable
 * until this is moved forward and re-tested. Versions are per toolkit (`YYYYMMDD_NN`), so each is
 * one that toolkit actually published: the current version on Composio's toolkit pages on
 * 2026-10-20, not yet checked against a real account's output.
 */
export const PINNED_TOOLKIT_VERSIONS: Record<string, string> = {
  gmail: '20261018_00',
  googlecalendar: '20261010_00',
};

export const COMPOSIO_CATALOG: Record<ApplicationId, CatalogApplication> = {
  gmail: {
    toolkitSlug: 'gmail',
    identity: { slug: 'GMAIL_GET_PROFILE', arguments: { user_id: 'me' } },
    actions: [
      { slug: 'GMAIL_FETCH_EMAILS', op: 'fetch_emails', mutating: false, risk: 'low', summary: 'Find messages in this mailbox with a Gmail search query.' },
      { slug: 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', op: 'fetch_message', mutating: false, risk: 'low', summary: 'Read one message by its id.' },
      { slug: 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID', op: 'fetch_thread', mutating: false, risk: 'low', summary: 'Read every message in one thread.' },
      { slug: 'GMAIL_GET_PROFILE', op: 'get_profile', mutating: false, risk: 'low', summary: 'Show which address this mailbox is.' },
      { slug: 'GMAIL_CREATE_EMAIL_DRAFT', op: 'create_draft', mutating: true, risk: 'medium', summary: 'Save a draft. Nothing is sent.' },
      { slug: 'GMAIL_SEND_DRAFT', op: 'send_draft', mutating: true, risk: 'high', summary: 'Send a saved draft from this mailbox.' },
      { slug: 'GMAIL_SEND_EMAIL', op: 'send_email', mutating: true, risk: 'high', summary: 'Send a message from this mailbox.' },
    ],
  },
  google_calendar: {
    toolkitSlug: 'googlecalendar',
    identity: { slug: 'GOOGLECALENDAR_GET_CALENDAR', arguments: { calendar_id: 'primary' } },
    actions: [
      { slug: 'GOOGLECALENDAR_LIST_CALENDARS', op: 'list_calendars', mutating: false, risk: 'low', summary: 'List the calendars this account can see.' },
      { slug: 'GOOGLECALENDAR_EVENTS_LIST', op: 'list_events', mutating: false, risk: 'low', summary: 'List events in one calendar for a date range.' },
      { slug: 'GOOGLECALENDAR_CREATE_EVENT', op: 'create_event', mutating: true, risk: 'high', summary: 'Create an event. Attendees are invited unless send_updates is "none".' },
    ],
  },
};

/** Typed Calendar reads, run at the pinned version for Ri's Calendar view and deck. */
export const CALENDAR_READS = {
  listCalendars: 'GOOGLECALENDAR_LIST_CALENDARS',
  listEvents: 'GOOGLECALENDAR_EVENTS_LIST',
} as const;

/** Changes whenever the reviewed catalog does, so sessions built for an older one are replaced. */
export const CATALOG_REVISION = createHash('sha256')
  .update(JSON.stringify({ catalog: COMPOSIO_CATALOG, pinned: PINNED_TOOLKIT_VERSIONS }))
  .digest('hex').slice(0, 16);

export function catalogAction(applicationId: ApplicationId, op: string): CatalogAction | undefined {
  return COMPOSIO_CATALOG[applicationId].actions.find(action => action.op === op);
}
