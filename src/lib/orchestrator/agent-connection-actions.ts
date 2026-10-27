/**
 * Connecting outside agents (Claude Code, Codex, Cursor, ...) to Ri's MCP
 * from a chat or the CLI: the same one-action setup as Settings → Connect
 * your agent → Set up (`src/lib/external-ai/local-setup.ts`), so Ri's main
 * chat can do it when asked ("connect Codex to Ri"). It writes on the
 * computer running Ri, so callers on another device are refused.
 */

import { z } from 'zod';
import { AI_CLIENTS, aiClient, type AiClientKind } from '@/lib/external-ai/client-config';
import { isTeamAuthority } from '@/lib/home/authority';
import { defineAction, ActionError, type ActionContext } from './types';

const LOCAL = AI_CLIENTS.filter(client => client.local);
const clientParam = z.enum(LOCAL.map(client => client.kind) as [AiClientKind, ...AiClientKind[]])
  .describe(`The outside agent: ${LOCAL.map(client => `${client.kind} (${client.label})`).join(', ')}.`);

async function setup() {
  return import('@/lib/external-ai/local-setup');
}

function assertHere(ctx: ActionContext, what: string): void {
  if (isTeamAuthority()) throw new ActionError('unsupported', `${what} belongs to a personal Ri, not a team.`);
  if (ctx.remote === false || ctx.caller?.location === 'home') return;
  throw new ActionError(
    'unsupported',
    `${what} changes agents on the computer running Ri, and this call came from another device.`,
    'For an agent on another computer, open Settings → Connect your agent, choose the agent and use Copy setup prompt.',
  );
}

async function translated<T>(work: () => Promise<T>): Promise<T> {
  const { LocalSetupError } = await setup();
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof LocalSetupError)) throw error;
    if (error.code === 'not_installed') throw new ActionError('not_found', error.message);
    if (error.code === 'conflict') throw new ActionError('conflict', error.message);
    if (error.code === 'unsupported') throw new ActionError('unsupported', error.message);
    throw error;
  }
}

const connect_agent = defineAction({
  name: 'connect_agent',
  description:
    'Connect an outside agent app on the computer running Ri (Claude Code, Codex, Cursor, VS Code, Gemini CLI and others) to Ri\'s MCP, ' +
    'so it can read and update the user\'s tasks, notes, areas and deck. In one step it makes that agent its own revocable key, adds Ri ' +
    'to the agent\'s user-level configuration the agent\'s own way (never a project\'s files) and installs Ri\'s skill for it. Use it when ' +
    'the user asks to "connect Codex to Ri" or similar. This is an outside app, not one of Ri\'s agents (workspaces). Running it again ' +
    'replaces the earlier connection. The agent loads it in its next session, so tell the user what `next` says. For an agent on another ' +
    'computer, point the user to Settings → Connect your agent → Copy setup prompt.',
  params: { client: clientParam },
  strictParams: true,
  mutating: true,
  cli: { positional: ['client'] },
  handler: async (ctx, { client }) => {
    assertHere(ctx, 'Connecting an agent');
    const { connectLocalAgent } = await setup();
    const result = await translated(() => connectLocalAgent(client));
    return {
      client,
      label: aiClient(client).label,
      server: result.server,
      config: result.config,
      key: { id: result.connection.keyId, name: result.connection.name },
      skills: result.skills,
      next: result.next,
    };
  },
});

const disconnect_agent = defineAction({
  name: 'disconnect_agent',
  description:
    'Disconnect an outside agent on the computer running Ri that connect_agent (or Settings) connected: removes the entry Ri wrote ' +
    'in its configuration and revokes its key. Ri\'s skill stays, since the agent can still use the `ri` command here. ' +
    'Only when the user asks.',
  params: { client: clientParam },
  strictParams: true,
  mutating: true,
  cli: { positional: ['client'] },
  handler: async (ctx, { client }) => {
    assertHere(ctx, 'Disconnecting an agent');
    const { disconnectLocalAgent } = await setup();
    return { client, label: aiClient(client).label, ...(await translated(() => disconnectLocalAgent(client))) };
  },
});

const list_agent_connections = defineAction({
  name: 'list_agent_connections',
  description:
    'List the outside agents Ri can connect on the computer running it: whether each is installed here, whether it\'s connected ' +
    'to Ri\'s MCP, and when its key was last used. Read before connect_agent to see what\'s installed.',
  params: {},
  strictParams: true,
  handler: async (ctx) => {
    assertHere(ctx, 'Listing connected agents');
    const { listLocalAgents } = await setup();
    const agents = await translated(listLocalAgents);
    return agents.map(agent => ({
      client: agent.kind,
      label: aiClient(agent.kind).label,
      installed: agent.installed,
      connected: Boolean(agent.connection),
      lastUsedAt: agent.connection?.lastUsedAt ?? null,
      ...(agent.stale ? { stale: agent.stale } : {}),
      config: agent.config,
    }));
  },
});

export const agentConnectionActions = [connect_agent, disconnect_agent, list_agent_connections] as const;
