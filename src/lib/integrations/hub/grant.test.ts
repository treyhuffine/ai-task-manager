import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { grantFromChoice, hubConsentOptions } from './grant';
import { startedByFor, trackAppCall, withStartedBy } from './origin';

const action = (id: string, mutating = false) => ({ id, description: id, input: z.object({}), mutating });
const toolkits = [
  { id: 'gmail', providerId: 'google', displayName: 'Gmail', actions: [action('gmail.search_messages'), action('gmail.get_message'), action('gmail.send_email', true)] },
  { id: 'google_calendar', providerId: 'google', displayName: 'Google Calendar', actions: [action('google_calendar.list_events')] },
  { id: 'app_reading_log', providerId: 'app_reading_log', displayName: 'Reading Log', actions: [action('app_reading_log.list_books')] },
] as never;
const connections = [
  { id: 'c-home', providerId: 'google', accountId: 'home', email: 'me@example.com', status: 'active' },
  { id: 'c-work', providerId: 'google', accountId: 'work', email: 'me@work.example', status: 'active' },
  { id: 'c-old', providerId: 'google', accountId: 'old', email: 'old@example.com', status: 'needs_reauth' },
  { id: 'c-rl', providerId: 'app_reading_log', accountId: 'place:ri', status: 'active' },
] as never;

describe('the hub consent screen', () => {
  it('offers each live account with its tools, never another app, and ticks what the app asked for', () => {
    const options = hubConsentOptions(toolkits, connections, 'mail.read ri__list_tasks');
    expect(options.accounts.map(a => [a.service, a.account])).toEqual([
      ['Gmail', 'me@example.com'], ['Gmail', 'me@work.example'], ['Google Calendar', 'me@example.com'], ['Google Calendar', 'me@work.example'],
    ]);
    const gmail = options.accounts[0]!;
    expect(gmail.tools.map(t => [t.name, t.requested, t.outside])).toEqual([
      ['gmail__search_messages', true, false], ['gmail__get_message', true, false], ['gmail__send_email', false, true],
    ]);
    expect(options.services.find(s => s.name === 'list_tasks')?.requested).toBe(true);
    expect(options.services.find(s => s.name === 'create_task')).toMatchObject({ requested: false, write: true });
  });

  it('grants only what the screen offered', () => {
    const options = hubConsentOptions(toolkits, connections, null);
    const grant = grantFromChoice(options, {
      tools: { 'c-home': ['gmail__search_messages', 'gmail__forged'], 'c-old': ['gmail__search_messages'], 'c-rl': ['app_reading_log__list_books'], 'c-work': [] },
      services: ['ai_text', 'shell'],
    });
    expect(grant).toEqual({ accounts: [{ connectionId: 'c-home', toolkitId: 'gmail', tools: ['gmail__search_messages'] }], services: ['ai_text'] });
  });
});

describe('what started a hub call', () => {
  it('is the job an app names, else the one chat or person Ri is calling the app for, else the app', async () => {
    const app = 'http://127.0.0.1:4391';
    expect(startedByFor([app], { 'app/job': 'import_receipts', 'app/jobRun': 'run-1' })).toEqual({ kind: 'job', label: 'import_receipts', id: 'run-1' });
    expect(startedByFor([app], undefined)).toEqual({ kind: 'app' });
    let seen;
    // Ri calls the app for a chat. The app answers by calling the hub at its localhost alias.
    await withStartedBy({ kind: 'chat', id: 'chat-1' }, () => trackAppCall(`${app}/mcp`, async () => { seen = startedByFor(['http://localhost:4391/api/hub/callback'], undefined); }));
    expect(seen).toEqual({ kind: 'chat', id: 'chat-1' });
    expect(startedByFor([app], undefined)).toEqual({ kind: 'app' });
    // Two callers at once can't be told apart.
    let both;
    await withStartedBy({ kind: 'chat', id: 'chat-1' }, () => trackAppCall(app, () => withStartedBy({ kind: 'person' }, () => trackAppCall(app, async () => { both = startedByFor([app], undefined); }))));
    expect(both).toEqual({ kind: 'app' });
  });
});
