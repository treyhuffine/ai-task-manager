/**
 * `<app> mcp connect <agent>`, `<app> mcp disconnect <agent>`, `<app> mcp list`.
 *
 * Connect an outside agent on this computer (Claude Code, Codex, Cursor,
 * VS Code, Gemini CLI, ...) to Ri's MCP in one step, the same setup as
 * Settings → Connect your agent → Set up. They run the `connect_agent`,
 * `disconnect_agent` and `list_agent_connections` actions, so a chat that
 * asks for it and a person at a terminal get the same result.
 */

import { Command } from 'commander';
import pc from 'picocolors';
import { APP_SHORT_ID } from '@/constants/app';
import { AI_CLIENTS, type AiClientKind } from '@/lib/external-ai/client-config';
import { dispatchAction } from '../lib/dispatch';

const LOCAL = AI_CLIENTS.filter(client => client.local);

/** Names people type for an agent, beyond its own id. */
const ALIASES: Record<string, AiClientKind> = {
  claude: 'claude_code',
  code: 'vscode',
  vs_code: 'vscode',
  claude_app: 'claude_desktop',
  gemini: 'gemini_cli',
  agy: 'antigravity',
  lmstudio: 'lm_studio',
};

/** The agent a name means, or null. Case, spaces and dashes don't matter. */
export function agentFromName(name: string): AiClientKind | null {
  const key = name.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const kind = ALIASES[key] ?? key;
  return LOCAL.some(client => client.kind === kind) ? kind as AiClientKind : null;
}

const choices = () => LOCAL.map(client => client.kind.replace(/_/g, '-')).join(', ');

function resolveAgent(name: string): AiClientKind {
  const kind = agentFromName(name);
  if (!kind) {
    console.error(pc.red(`Ri can't set up "${name}" on this computer. Choose one of: ${choices()}.`));
    process.exit(1);
  }
  return kind;
}

type Envelope = Awaited<ReturnType<typeof dispatchAction>>;

function failed(envelope: Envelope): envelope is Extract<Envelope, { ok: false }> {
  if (envelope.ok) return false;
  console.error(pc.red(envelope.error.message));
  if ('suggestion' in envelope.error && envelope.error.suggestion) console.error(pc.dim(String(envelope.error.suggestion)));
  process.exitCode = 1;
  return true;
}

function since(iso: string | null): string {
  if (!iso) return 'not used yet';
  return `last used ${new Date(iso).toLocaleString()}`;
}

export function registerMcpCommand(program: Command) {
  const mcp = program
    .command('mcp')
    .description('Connect agents on this computer (Claude Code, Codex, Cursor and more) to Ri’s MCP');

  mcp
    .command('connect <agent>')
    .description(`Connect an agent to Ri's MCP in one step: its own key, Ri in its user-level configuration and Ri's skill. Agents: ${choices()}`)
    .option('--json', 'Print the result as JSON')
    .action(async (name: string, opts: { json?: boolean }) => {
      const envelope = await dispatchAction('connect_agent', { client: resolveAgent(name) });
      if (opts.json) { console.log(JSON.stringify(envelope, null, 2)); if (!envelope.ok) process.exitCode = 1; return; }
      if (failed(envelope)) return;
      const result = envelope.result as { label: string; server: string; config: string; skills: { state: string; blocked: string[] }; next: string };
      console.log(`${pc.green('✓')} Connected ${pc.bold(result.label)} to Ri as ${pc.bold(result.server)} ${pc.dim(`(${result.config})`)}`);
      if (result.skills.state === 'ready') console.log(`${pc.green('✓')} Ri's skill is installed for it`);
      if (result.skills.state === 'blocked') console.log(pc.yellow(`! Another skill already uses Ri's skill name${result.skills.blocked.length ? ` at ${result.skills.blocked.join(', ')}` : ''}, so Ri left it alone.`));
      console.log(result.next);
    });

  mcp
    .command('disconnect <agent>')
    .description('Remove Ri from an agent’s configuration and revoke its key')
    .option('--json', 'Print the result as JSON')
    .action(async (name: string, opts: { json?: boolean }) => {
      const envelope = await dispatchAction('disconnect_agent', { client: resolveAgent(name) });
      if (opts.json) { console.log(JSON.stringify(envelope, null, 2)); if (!envelope.ok) process.exitCode = 1; return; }
      if (failed(envelope)) return;
      const result = envelope.result as { label: string; removed: boolean };
      console.log(result.removed ? `${pc.green('✓')} Disconnected ${pc.bold(result.label)}` : `${result.label} wasn't connected to this Ri.`);
    });

  mcp
    .command('list')
    .description('Show which agents on this computer are connected to Ri')
    .option('--json', 'Print the result as JSON')
    .action(async (opts: { json?: boolean }) => {
      const envelope = await dispatchAction('list_agent_connections', {});
      if (opts.json) { console.log(JSON.stringify(envelope, null, 2)); if (!envelope.ok) process.exitCode = 1; return; }
      if (failed(envelope)) return;
      const agents = envelope.result as Array<{ client: string; label: string; installed: boolean; connected: boolean; lastUsedAt: string | null; stale?: string }>;
      for (const agent of agents) {
        const state = agent.connected
          ? pc.green(`connected, ${since(agent.lastUsedAt)}`)
          : agent.installed
            ? agent.stale === 'revoked' ? pc.yellow('its key was revoked, connect it again') : `installed, not connected ${pc.dim(`(${APP_SHORT_ID} mcp connect ${agent.client.replace(/_/g, '-')})`)}`
            : pc.dim('not installed');
        console.log(`  ${agent.label.padEnd(12)} ${state}`);
      }
    });
}
