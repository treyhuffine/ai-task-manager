import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type {
  SkillCommandDescriptor,
  RuntimeCommandInventory,
  SkillCommandDiagnostic,
} from '@agentex/agent';

/**
 * Verify the slash-commands route's *integration policy* — the things
 * the route decides on top of agentex's primitives:
 *   - 404 on missing session or agent
 *   - Filters out `userInvocable: false`
 *   - Filters out `available: false`
 *   - Passes diagnostics through unchanged
 *   - Reports inventorySource correctly
 *
 * agentex's own behavior (discovery, reconciliation) is mocked — that's
 * tested upstream in `packages/agent/tests/utils/skill-commands.test.ts`.
 */

const discoverSkillCommands = vi.fn();
const reconcileSkillCommands = vi.fn();
const getChatSession = vi.fn();
const getAgent = vi.fn();
const getSessionInventory = vi.fn();

vi.mock('@agentex/agent', () => ({
  discoverSkillCommands: (...args: unknown[]) => discoverSkillCommands(...args),
  reconcileSkillCommands: (...args: unknown[]) => reconcileSkillCommands(...args),
}));

vi.mock('@/lib/db/queries', () => ({
  getChatSession: (id: string) => getChatSession(id),
  getAgent: (id: string) => getAgent(id),
}));

vi.mock('@/lib/executor/adapter', () => ({
  getSessionInventory: (id: string) => getSessionInventory(id),
}));

vi.mock('@/lib/config/paths', () => ({
  getAppRoot: () => '/tmp/test-app-root',
}));

import { GET } from './route';

const SESSION_ID = 'sess-1';

function descriptor(overrides: Partial<SkillCommandDescriptor> = {}): SkillCommandDescriptor {
  return {
    id: 'claude:orchestrator:/path',
    name: 'orchestrator',
    description: 'A skill',
    source: 'installed-workspace',
    userInvocable: true,
    available: true,
    execution: {
      kind: 'provider-slash',
      provider: 'claude',
      commandText: '/orchestrator',
    },
    ...overrides,
  };
}

function makeRequest(): NextRequest {
  return new Request('http://localhost/api/sessions/sess-1/slash-commands') as unknown as NextRequest;
}

function makeParams(id: string = SESSION_ID) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  discoverSkillCommands.mockReset();
  reconcileSkillCommands.mockReset();
  getChatSession.mockReset();
  getAgent.mockReset();
  getSessionInventory.mockReset();

  // Sensible defaults: session/agent exist, no inventory, empty discovery.
  getChatSession.mockReturnValue({ id: SESSION_ID, agentId: 'agent-1' });
  getAgent.mockReturnValue({ id: 'agent-1', harness: 'claude_code' });
  getSessionInventory.mockReturnValue(null);
  discoverSkillCommands.mockResolvedValue({ commands: [], diagnostics: [] });
  reconcileSkillCommands.mockImplementation(({ discovered }) => discovered);
});

describe('GET /api/sessions/[id]/slash-commands', () => {
  it('returns 404 when the chat session is missing', async () => {
    getChatSession.mockReturnValue(undefined);

    const res = await GET(makeRequest(), makeParams());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'session not found' });
  });

  it('returns 404 when the agent is missing', async () => {
    getAgent.mockReturnValue(undefined);

    const res = await GET(makeRequest(), makeParams());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'agent not found' });
  });

  it('filters out commands with userInvocable: false', async () => {
    const visible = descriptor({ name: 'visible' });
    const hidden = descriptor({ name: 'hidden', userInvocable: false });
    discoverSkillCommands.mockResolvedValue({ commands: [visible, hidden], diagnostics: [] });

    const res = await GET(makeRequest(), makeParams());

    const body = await res.json();
    expect(body.commands).toHaveLength(1);
    expect(body.commands[0].name).toBe('visible');
  });

  it('filters out commands with available: false', async () => {
    const visible = descriptor({ name: 'visible' });
    const gated = descriptor({ name: 'gated', available: false });
    discoverSkillCommands.mockResolvedValue({ commands: [visible, gated], diagnostics: [] });

    const res = await GET(makeRequest(), makeParams());

    const body = await res.json();
    expect(body.commands).toHaveLength(1);
    expect(body.commands[0].name).toBe('visible');
  });

  it('passes diagnostics through unchanged', async () => {
    const diagnostics: SkillCommandDiagnostic[] = [
      { level: 'warning', path: '/skills/bad', message: 'Malformed YAML' },
    ];
    discoverSkillCommands.mockResolvedValue({ commands: [], diagnostics });

    const body = await (await GET(makeRequest(), makeParams())).json();

    expect(body.diagnostics).toEqual(diagnostics);
  });

  it('reports inventorySource="none" when no inventory was captured', async () => {
    getSessionInventory.mockReturnValue(null);

    const body = await (await GET(makeRequest(), makeParams())).json();

    expect(body.inventorySource).toBe('none');
  });

  it('reports inventorySource from the captured inventory', async () => {
    const inventory: RuntimeCommandInventory = {
      provider: 'claude',
      sessionId: 'claude-abc',
      slashCommands: [],
      skills: ['orchestrator'],
      source: 'provider-init',
    };
    getSessionInventory.mockReturnValue(inventory);

    const body = await (await GET(makeRequest(), makeParams())).json();

    expect(body.inventorySource).toBe('provider-init');
  });

  it('passes the captured inventory into reconcileSkillCommands', async () => {
    const inventory: RuntimeCommandInventory = {
      provider: 'claude',
      sessionId: null,
      slashCommands: [],
      skills: ['orchestrator'],
      source: 'provider-init',
    };
    getSessionInventory.mockReturnValue(inventory);

    await GET(makeRequest(), makeParams());

    expect(reconcileSkillCommands).toHaveBeenCalledWith(
      expect.objectContaining({ inventory, provider: 'claude' }),
    );
  });

  it('maps the agent harness to the provider name', async () => {
    getAgent.mockReturnValue({ id: 'agent-1', harness: 'claude_code' });

    await GET(makeRequest(), makeParams());

    expect(discoverSkillCommands).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: 'claude' }),
    );
    expect(reconcileSkillCommands).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'claude' }),
    );
  });

  it('keeps undefined userInvocable as visible (default is true)', async () => {
    // agentex's parser defaults user-invocable to true. A descriptor
    // with `userInvocable: undefined` should be treated the same.
    const cmd = descriptor({ name: 'default-visible' });
    delete (cmd as Partial<SkillCommandDescriptor>).userInvocable;
    discoverSkillCommands.mockResolvedValue({ commands: [cmd], diagnostics: [] });

    const body = await (await GET(makeRequest(), makeParams())).json();

    expect(body.commands).toHaveLength(1);
  });
});
