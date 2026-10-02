import { describe, it, expect } from 'vitest';
import { PROVIDER_CATALOG } from '@connectors/engine/providers';
import {
  connectionNote,
  describeAccounts,
  matchAccounts,
  namesAccount,
  resolveService,
  type CardAccount,
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
    const note = connectionNote('connected', gmail, { accounts: ['me@example.com'] });
    expect(note).toMatch(/^\[Connection, from the app on the user's behalf\]/);
    expect(note).toContain('The user connected Gmail on me@example.com.');
    expect(note).toContain('Its tools (gmail__…) are available now. Continue the task you were doing.');
  });

  it('names every account granted, and how to choose between them', () => {
    const note = connectionNote('allowed', { ...gmail, kind: 'allow_agent' }, { accounts: ['a@x.com', 'b@y.com'] });
    expect(note).toContain('allowed this agent to use Gmail on a@x.com and b@y.com (pass `account` to choose).');
  });

  it('falls back to the card account, as a reconnect has', () => {
    expect(connectionNote('connected', { ...gmail, kind: 'reconnect', account: 'me@example.com' })).toContain('reconnected Gmail on me@example.com.');
  });

  it('flags a sign-in that landed on another account than the one asked for', () => {
    const asked = { ...gmail, requestedAccount: 'Market Standard' };
    expect(connectionNote('connected', asked, { accounts: ['trey@marketstandard.app'] })).not.toContain("isn't the account");
    expect(connectionNote('connected', asked, { accounts: ['trey@gitconnected.com'] })).toContain(
      "That isn't the account you asked for (Market Standard), so check with the user before relying on it.",
    );
    // An access grant is the user's own pick on the card, not a sign-in that went astray.
    expect(connectionNote('allowed', { ...asked, kind: 'allow_agent' }, { accounts: ['trey@gitconnected.com'] })).not.toContain("isn't the account");
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

describe('matchAccounts', () => {
  const account = (accountId: string, label: string): CardAccount => ({ accountId, authConfigId: null, connectionId: `c-${accountId}`, label });
  const ACCOUNTS = [
    account('1', 'trey@gitconnected.com'),
    account('2', 'trey@marketstandard.app'),
    account('3', 'trey@insiderfinance.io'),
    account('4', 'Work Slack'),
  ];
  const ids = (hint: string | null) => matchAccounts(hint, ACCOUNTS).map((a) => a.accountId);

  it('matches an exact email, label or account id, ignoring case', () => {
    expect(ids('Trey@MarketStandard.app')).toEqual(['2']);
    expect(ids('work slack')).toEqual(['4']);
    expect(ids('3')).toEqual(['3']);
  });

  it('matches the words the user used when they name one account', () => {
    expect(ids('Market Standard')).toEqual(['2']);
    expect(ids('marketstandard.app')).toEqual(['2']);
    expect(ids('my Market Standard email')).toEqual(['2']);
    expect(ids('my insiderfinance gmail account')).toEqual(['3']);
    expect(ids('insider finance')).toEqual(['3']);
  });

  it('names none when the words fit several, or are too short or too generic to mean anything', () => {
    expect(ids('trey')).toEqual([]);
    expect(ids('io')).toEqual([]);
    expect(ids('my email')).toEqual([]);
    expect(ids('')).toEqual([]);
    expect(ids(null)).toEqual([]);
  });

  it('matches an address only exactly: a different address is a different account', () => {
    expect(ids('trey@bounce.dev')).toEqual([]);
    expect(ids('rey@marketstandard.app')).toEqual([]);
  });
});

describe('namesAccount', () => {
  it('tells a name from words that only say what kind of account', () => {
    expect(namesAccount('trey@bounce.dev')).toBe(true);
    expect(namesAccount('my Market Standard email')).toBe(true);
    expect(namesAccount('my email')).toBe(false);
    expect(namesAccount('the gmail account')).toBe(false);
    expect(namesAccount('  ')).toBe(false);
    expect(namesAccount(null)).toBe(false);
  });
});

describe('describeAccounts', () => {
  it('reads as a list', () => {
    expect(describeAccounts([])).toBe('');
    expect(describeAccounts(['a'])).toBe('a');
    expect(describeAccounts(['a', 'b'])).toBe('a and b');
    expect(describeAccounts(['a', 'b', 'c'])).toBe('a, b and c');
  });
});
