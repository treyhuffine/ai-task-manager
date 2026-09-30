import { describe, it, expect } from 'vitest';
import { PROVIDER_CATALOG } from '@connectors/engine/providers';
import {
  connectionNote,
  resolveService,
  type CatalogToolkit,
  type ServiceResolution,
} from './connection-catalog';

// The real toolkit inventory (id, provider, display name) from @connectors/engine providers.
const TOOLKITS: CatalogToolkit[] = [
  ['gmail', 'google', 'Gmail'],
  ['google_calendar', 'google', 'Google Calendar'],
  ['google_drive', 'google', 'Google Drive'],
  ['google_docs', 'google', 'Google Docs'],
  ['google_sheets', 'google', 'Google Sheets'],
  ['outlook_mail', 'microsoft', 'Outlook Mail'],
  ['outlook_calendar', 'microsoft', 'Outlook Calendar'],
  ['slack', 'slack', 'Slack'],
  ['notion', 'notion', 'Notion'],
  ['linear', 'linear', 'Linear'],
  ['jira', 'jira', 'Jira'],
  ['confluence', 'confluence', 'Confluence'],
  ['discord', 'discord', 'Discord'],
  ['calendly', 'calendly', 'Calendly'],
  ['raindrop', 'raindrop', 'Raindrop'],
  ['zoom', 'zoom', 'Zoom'],
  ['hubspot', 'hubspot', 'HubSpot'],
  ['salesforce', 'salesforce', 'Salesforce'],
  ['todoist', 'todoist', 'Todoist'],
  ['airtable', 'airtable', 'Airtable'],
  ['readwise', 'readwise', 'Readwise'],
  ['stripe', 'stripe', 'Stripe'],
  ['plaid', 'plaid', 'Plaid'],
  ['telegram', 'telegram', 'Telegram'],
  ['whatsapp', 'whatsapp', 'WhatsApp'],
  ['gitlab', 'gitlab', 'GitLab'],
  ['asana', 'asana', 'Asana'],
  ['zendesk', 'zendesk', 'Zendesk'],
  ['dropbox', 'dropbox', 'Dropbox'],
  ['box', 'box', 'Box'],
  ['quickbooks', 'quickbooks', 'QuickBooks'],
  ['resend', 'resend', 'Resend'],
  ['mailgun', 'mailgun', 'Mailgun'],
  ['twitter', 'twitter', 'X (Twitter)'],
].map(([id, providerId, displayName]) => ({ id: id!, providerId: providerId!, displayName: displayName! }));

const resolve = (q: string) => resolveService(q, TOOLKITS, PROVIDER_CATALOG);
const match = (r: ServiceResolution) => (r.kind === 'match' ? r.match : null);

describe('resolveService', () => {
  it('resolves a named service to its toolkit', () => {
    expect(match(resolve('Gmail'))).toEqual({ providerId: 'google', providerName: 'Google', toolkitIds: ['gmail'], label: 'Gmail' });
    expect(match(resolve('my Google Calendar'))?.toolkitIds).toEqual(['google_calendar']);
    expect(match(resolve('google_sheets'))?.toolkitIds).toEqual(['google_sheets']);
    expect(match(resolve('the Slack workspace'))?.label).toBe('Slack');
    expect(match(resolve('X (Twitter)'))?.toolkitIds).toEqual(['twitter']);
  });

  it('resolves a provider to all of its toolkits', () => {
    expect(match(resolve('Google'))).toMatchObject({ providerId: 'google', label: 'Google' });
    expect(match(resolve('Google'))?.toolkitIds).toHaveLength(5);
    expect(match(resolve('Microsoft 365'))?.toolkitIds).toEqual(['outlook_mail', 'outlook_calendar']);
  });

  it('collapses options that are one sign-in', () => {
    expect(match(resolve('outlook'))).toMatchObject({ providerId: 'microsoft', label: 'Microsoft 365' });
  });

  it('reports generic words with several providers as ambiguous', () => {
    const r = resolve('calendar');
    expect(r.kind).toBe('ambiguous');
    expect(r.kind === 'ambiguous' && r.options.map((o) => o.label)).toEqual(['Google Calendar', 'Outlook Calendar']);
    expect(resolve('my email inbox').kind).toBe('ambiguous');
    expect(resolve('issues').kind).toBe('ambiguous');
  });

  it('resolves generic words with a single candidate', () => {
    expect(match(resolve('banking'))?.label).toBe('Plaid');
    expect(match(resolve('bookmarks'))?.label).toBe('Raindrop');
  });

  it('prefers the most specific name', () => {
    // "google calendar" names a toolkit, so it beats the provider "google" and the word "calendar".
    expect(match(resolve('calendar in google calendar'))?.toolkitIds).toEqual(['google_calendar']);
  });

  it('says so when Ri cannot connect it', () => {
    expect(resolve('Spotify').kind).toBe('unsupported');
    expect(resolve('').kind).toBe('unsupported');
    expect(resolve('my tasks').kind).toBe('unsupported');
  });

  it('ignores toolkits whose provider is not in the catalog', () => {
    const mcp: CatalogToolkit = { id: 'mcp_team', providerId: 'mcp_team', displayName: 'Team Calendar' };
    expect(resolveService('team calendar', [...TOOLKITS, mcp], PROVIDER_CATALOG).kind).not.toBe('match');
  });
});

describe('connectionNote', () => {
  const gmail = { kind: 'connect' as const, label: 'Gmail', toolkitIds: ['gmail'], account: null };

  it('tells the agent the tools are there and to continue', () => {
    const note = connectionNote('connected', gmail, { account: 'me@example.com' });
    expect(note).toMatch(/^\[Connection, from the app on the user's behalf\]/);
    expect(note).toContain('The user connected Gmail (account me@example.com).');
    expect(note).toContain('Its tools (gmail__…) are available now. Continue the task you were doing.');
  });

  it('asks for a retry after a reconnect or more access', () => {
    expect(connectionNote('connected', { ...gmail, kind: 'reconnect' })).toContain('reconnected Gmail. Retry the call that failed.');
    expect(connectionNote('connected', { ...gmail, kind: 'more_access' })).toContain('extra access it needed. Retry');
  });

  it('reports access given to this agent', () => {
    expect(connectionNote('allowed', { ...gmail, kind: 'allow_agent' })).toContain('allowed this agent to use Gmail');
  });

  it('reports the outcome for another agent without telling this one to continue', () => {
    const note = connectionNote('allowed', { ...gmail, kind: 'allow_agent' }, { forOtherAgent: 'ri' });
    expect(note).toContain('The user allowed the "ri" agent to use Gmail.');
    expect(note).not.toContain('Continue');
  });

  it('tells the agent not to ask again after a decline', () => {
    const note = connectionNote('declined', gmail);
    expect(note).toContain('chose not to connect Gmail');
    expect(note).toContain("Don't ask for it again in this chat unless they bring it up.");
  });
});
