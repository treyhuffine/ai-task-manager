/**
 * Does a real agent ask to connect an account at the right moments? (docs/connecting-from-chat.md)
 *
 * Runs prompts against a running dev app, each in a fresh main chat, and reports whether the agent
 * called `request_connection`, what the server answered, and whether a Connect card appeared.
 * Grades each case against what should happen:
 *
 *   ask             a Connect card for the expected service appears
 *   no_ask          the agent never calls request_connection
 *   ask_user_first  no card, and the agent's reply asks the user which service they use
 *   declined        after "Not now" on the first card, a follow-up in the same chat raises no new card
 *
 * The `connected` cases need an MCP server to stand in for a connected service: pass --mcp-url and
 * the script adds it (as "Team Calendar") before running them.
 *
 * Usage (dev app already running on an isolated home, see docs/connecting-from-chat.md):
 *   pnpm tsx scripts/eval-connection-requests.ts --base http://localhost:42277 --home /tmp/ri-eval \
 *     [--mcp-url http://127.0.0.1:42288/mcp] [--only id1,id2] [--out results.json]
 *
 * Spends one short agent turn per case on the default harness. Refuses the production home.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Expect = 'ask' | 'no_ask' | 'ask_user_first' | 'declined';

interface Case {
  id: string;
  prompt: string;
  expect: Expect;
  /** For `ask`: the card's service should match. */
  service?: RegExp;
  /** For `declined`: the follow-up asked in the same chat after "Not now". */
  followUp?: string;
  phase: 'baseline' | 'connected';
  /** Run in an execution of an agent with no connector access, instead of the main chat. */
  inAgent?: boolean;
}

const CASES: Case[] = [
  // Should ask: the request needs an outside service there are no tools for.
  { id: 'gcal-tomorrow', phase: 'baseline', expect: 'ask', service: /google calendar|google/i, prompt: "What's on my Google Calendar tomorrow?" },
  { id: 'gmail-reply', phase: 'baseline', expect: 'ask', service: /gmail|google/i, prompt: "Reply to Ana's latest email in Gmail and tell her Thursday works." },
  { id: 'connect-slack', phase: 'baseline', expect: 'ask', service: /slack/i, prompt: 'Connect my Slack.' },
  { id: 'slack-post', phase: 'baseline', expect: 'ask', service: /slack/i, prompt: "Post 'deploy done' in the #eng channel on Slack." },
  { id: 'linear-ticket', phase: 'baseline', expect: 'ask', service: /linear/i, prompt: 'Find the Linear ticket about the login bug and summarize it for me.' },
  { id: 'outlook-event', phase: 'baseline', expect: 'ask', service: /outlook|microsoft/i, prompt: 'Add a meeting with Sam to my Outlook calendar for Friday at 2pm.' },
  // Should not ask: Ri's own data, pasted content, or no outside service needed.
  { id: 'ri-task', phase: 'baseline', expect: 'no_ask', prompt: 'Add a task to call mom tomorrow.' },
  { id: 'pasted-email', phase: 'baseline', expect: 'no_ask', prompt: "Summarize this email in one line: 'Hi Trey, the Q3 numbers are in. Revenue is up 18%, churn is down to 2.1%, and the new plan launched on time. Deck on Friday. Ana'" },
  { id: 'launch-plan', phase: 'baseline', expect: 'no_ask', prompt: 'Draft a short launch plan for a new onboarding flow. Just reply here, no need to save it.' },
  { id: 'arithmetic', phase: 'baseline', expect: 'no_ask', prompt: "What's 17 times 23?" },
  { id: 'ri-note', phase: 'baseline', expect: 'no_ask', prompt: 'Write a note titled "Connector ideas" saying we should try Linear next.' },
  // Should ask the user which one first: more than one service could fit.
  { id: 'calendar-which', phase: 'baseline', expect: 'ask_user_first', prompt: "What's on my calendar tomorrow?" },
  { id: 'email-which', phase: 'baseline', expect: 'ask_user_first', prompt: 'Check my email for anything from the bank.' },
  // A "Not now" sticks for the chat.
  { id: 'declined-sticks', phase: 'baseline', expect: 'declined', prompt: 'Find the Notion page about Q3 planning.', followUp: 'What about the Notion page for Q4 planning?' },
  // Should not ask: the service is connected and its tools are there.
  { id: 'team-calendar', phase: 'connected', expect: 'no_ask', prompt: "Look up event evt_standup on the Team Calendar and tell me when it is." },
  // Should ask for access: connected to Ri, but this agent hasn't been given it.
  { id: 'agent-access', phase: 'connected', expect: 'ask', service: /team calendar/i, inAgent: true, prompt: "Look up event evt_standup on the Team Calendar and tell me when it is." },
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const base = (arg('base') ?? '').replace(/\/+$/, '');
const home = arg('home') ?? '';
if (!base || !home) {
  console.error('Usage: pnpm tsx scripts/eval-connection-requests.ts --base <url> --home <dev home> [--mcp-url <url>] [--only a,b] [--out file]');
  process.exit(2);
}
const prodHome = path.join(os.homedir(), 'ri');
const resolvedHome = fs.realpathSync(home);
if (resolvedHome === prodHome || resolvedHome.startsWith(`${prodHome}/`)) {
  console.error(`Refusing to run against the production home (${resolvedHome}).`);
  process.exit(2);
}
const token = (JSON.parse(fs.readFileSync(path.join(resolvedHome, '.config', 'config.json'), 'utf8')) as { localToken: string }).localToken;

async function call<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

interface Event {
  id: string;
  source: string;
  toolName: string | null;
  toolInput: unknown;
  content: string | null;
}

async function events(sessionId: string): Promise<Event[]> {
  const data = await call<Event[] | { events: Event[] }>('GET', `/sessions/${sessionId}/events?limit=500`);
  return Array.isArray(data) ? data : data.events;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send a message and wait until the agent's turn (and any turn a note starts) has settled. */
async function sendAndSettle(sessionId: string, content: string, timeoutMs = 240_000): Promise<void> {
  const before = (await events(sessionId)).length;
  await call('POST', `/sessions/${sessionId}/messages`, { content });
  await settle(sessionId, before, timeoutMs);
}

async function settle(sessionId: string, afterCount: number, timeoutMs = 240_000): Promise<void> {
  const started = Date.now();
  let quietSince = 0;
  while (Date.now() - started < timeoutMs) {
    await sleep(2_000);
    const { running } = await call<{ running: boolean }>('GET', `/sessions/${sessionId}/runtime-status`);
    const evs = await events(sessionId);
    const replied = evs.slice(afterCount).some((e) => e.source === 'agent' || e.source === 'result');
    if (!running && replied) {
      // Stay idle a few seconds: a card answer or note may start another turn.
      if (!quietSince) quietSince = Date.now();
      if (Date.now() - quietSince > 6_000) return;
    } else {
      quietSince = 0;
    }
  }
  throw new Error(`timed out waiting for ${sessionId}`);
}

interface Observed {
  calls: { service: string; status: string | null }[];
  cards: { id: string; label: string; kind: string }[];
  reply: string;
}

function observe(evs: Event[]): Observed {
  // The transcript doesn't keep an MCP tool's result text, so a call's outcome is read from what
  // it left behind: a card row right after it, or none.
  const calls: Observed['calls'] = [];
  evs.forEach((e, i) => {
    if (e.source !== 'tool_call' || !e.toolName?.includes('request_connection')) return;
    const service = String((e.toolInput as { service?: unknown } | null)?.service ?? '');
    const next = evs.slice(i + 1).find((x) => x.source === 'connection_request' || (x.source === 'tool_call' && x.toolName?.includes('request_connection')));
    calls.push({ service, status: next?.source === 'connection_request' ? 'card' : 'no card' });
  });
  const cards = evs
    .filter((e) => e.source === 'connection_request')
    .map((e) => ({ id: e.id, label: String((e.toolInput as { label?: unknown }).label), kind: String((e.toolInput as { kind?: unknown }).kind) }));
  const reply = [...evs].reverse().find((e) => e.source === 'agent')?.content ?? '';
  return { calls, cards, reply };
}

interface Result {
  id: string;
  expect: Expect;
  pass: boolean;
  why: string;
  observed: Observed;
  followUp?: Observed;
}

let evalAgentId: string | null = null;

/** An agent with its own folder and no connector access, for the `inAgent` cases. */
async function evalAgent(): Promise<string> {
  if (evalAgentId) return evalAgentId;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-eval-agent-'));
  const created = await call<{ workspace?: { id: string }; id?: string }>('POST', '/workspaces', { name: `eval-agent-${path.basename(cwd).slice(-6)}`, cwd });
  evalAgentId = created.workspace?.id ?? created.id ?? null;
  if (!evalAgentId) throw new Error('could not create the eval agent');
  return evalAgentId;
}

async function newChat(c: Case): Promise<string> {
  if (c.inAgent) {
    const created = await call<{ session?: { id: string }; id?: string }>('POST', `/workspaces/${await evalAgent()}/sessions`, { label: c.id });
    return (created.session?.id ?? created.id)!;
  }
  return (await call<{ session: { id: string } }>('POST', '/orchestrator-chat', {})).session.id;
}

async function runCase(c: Case): Promise<Result> {
  const session = { id: await newChat(c) };
  await sendAndSettle(session.id, c.prompt);
  const first = observe(await events(session.id));
  const done = (pass: boolean, why: string, followUp?: Observed): Result => ({ id: c.id, expect: c.expect, pass, why, observed: first, ...(followUp ? { followUp } : {}) });

  switch (c.expect) {
    case 'ask': {
      const card = first.cards.find((k) => c.service!.test(k.label));
      return done(Boolean(card), card ? `card: ${card.label}` : `no card for ${c.service}`);
    }
    case 'no_ask':
      return done(first.calls.length === 0, first.calls.length ? `asked: ${first.calls.map((k) => k.service).join(', ')}` : 'did not ask');
    case 'ask_user_first': {
      const asksUser = /\?/.test(first.reply);
      return done(first.cards.length === 0 && asksUser, `${first.cards.length} card(s), reply ${asksUser ? 'asks' : 'does not ask'} the user`);
    }
    case 'declined': {
      const card = first.cards[0];
      if (!card) return done(false, 'no first card to decline');
      const count = (await events(session.id)).length;
      await call('POST', `/connectors/requests/${card.id}`, { action: 'decline' });
      await settle(session.id, count);
      const beforeFollowUp = first.cards.length;
      await sendAndSettle(session.id, c.followUp!);
      const after = observe(await events(session.id));
      const newCards = after.cards.length - beforeFollowUp;
      return done(newCards === 0, newCards === 0 ? 'no new card after Not now' : `${newCards} new card(s) after Not now`, after);
    }
  }
}

async function main() {
  const only = arg('only')?.split(',');
  const cases = CASES.filter((c) => !only || only.includes(c.id));
  const results: Result[] = [];
  for (const phase of ['baseline', 'connected'] as const) {
    const batch = cases.filter((c) => c.phase === phase);
    if (batch.length === 0) continue;
    if (phase === 'connected') {
      const url = arg('mcp-url');
      if (!url) {
        console.log('Skipping connected cases (no --mcp-url).');
        continue;
      }
      await call('POST', '/connectors/mcp-servers', { name: 'Team Calendar', url, auth: { kind: 'none' } }).catch((e) => console.log(`(MCP server: ${e.message})`));
    }
    for (const c of batch) {
      process.stdout.write(`${c.id.padEnd(18)} `);
      try {
        const r = await runCase(c);
        results.push(r);
        console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.expect.padEnd(15)} ${r.why}`);
      } catch (e) {
        results.push({ id: c.id, expect: c.expect, pass: false, why: String(e), observed: { calls: [], cards: [], reply: '' } });
        console.log(`ERROR ${String(e)}`);
      }
    }
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  const out = arg('out');
  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}

void main();
