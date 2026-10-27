/**
 * One-click setup for outside agents on the computer running Ri: Settings →
 * Connect your agent → Set up, the `connect_agent` action and `ri mcp connect`
 * all come here. In one action it makes the agent's own key, writes Ri's server
 * into the agent's user-level configuration the agent's own way (its CLI, or
 * the file its docs name), with the key where the agent reads it, and puts
 * Ri's skills in the agent's skill folder. Never in a project's files, never
 * through a shell, so the key reaches no shell history.
 *
 * What's connected is read back from each agent's configuration, never kept
 * on the side: Ri's entry is the one under its server name (`ri`, or `ri-dev`
 * for a development Ri) whose key is one of this Ri's working keys. So a
 * person removing the entry by hand, or revoking the key, shows here as it is.
 * Disconnect removes the entry Ri wrote and revokes its key.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as jsonc from 'jsonc-parser';
import { findBinary } from '@agentex/agent';
import { getLocalBaseUrl } from '@/lib/auth/bootstrap';
import * as q from '@/lib/db/queries';
import { defaultDeviceName } from '@/lib/home/device-name';
import { assertPersonalCapability } from '@/lib/home/authority';
import { HARNESS_REGISTRY, type HarnessId } from '@/lib/harness/registry';
import { homeEnvironment } from '@/lib/server/operations/system/host-info';
import { untraced } from '@/lib/utils/untraced';
import { installGlobalSkills, inspectSkillFolders, type SkillFolder } from '@/lib/agent-skills/shipped';
import { homeMcpAddress } from './address';
import {
  AI_CLIENTS,
  aiClient,
  clientFilePath,
  codexTable,
  personalMcpNames,
  type AiClientDef,
  type AiClientJsonConfig,
  type AiClientKind,
} from './client-config';

/** A connection problem a person can act on. Its message says what to do. */
export class LocalSetupError extends Error {
  constructor(public readonly code: 'not_installed' | 'unsupported' | 'conflict' | 'failed', message: string) {
    super(message);
    this.name = 'LocalSetupError';
  }
}

export interface LocalAgentState {
  kind: AiClientKind;
  /** Found on this computer, so Ri can set it up here. */
  installed: boolean;
  /** Ri's entry in its configuration, with one of this Ri's working keys. */
  connection: q.AiClientView | null;
  /**
   * An entry under Ri's server name that isn't a working connection to this
   * Ri: its key was revoked, or it points somewhere else. Set up replaces it
   * only when it's a Ri's.
   */
  stale: 'revoked' | 'elsewhere' | null;
  /** Its configuration file, `~` for the home folder. */
  config: string;
}

export interface LocalConnectResult {
  kind: AiClientKind;
  connection: q.AiClientView;
  config: string;
  server: string;
  /** Ri's skills in the agent's skill folder: ready, none for this agent, or blocked by someone's own skill. */
  skills: { state: 'ready' | 'none' | 'blocked'; blocked: string[] };
  /** What the person does next, usually a restart. */
  next: string;
}

const home = () => os.homedir();

/** `~/x` or `%APPDATA%\x` for this computer. */
function expandPath(file: string): string {
  if (file.startsWith('~/')) return path.join(/* turbopackIgnore: true */ home(), file.slice(2));
  if (file.startsWith('%APPDATA%')) return path.join(/* turbopackIgnore: true */ process.env.APPDATA ?? path.join(home(), 'AppData', 'Roaming'), file.slice('%APPDATA%'.length));
  return file;
}

function displayPath(file: string): string {
  return file.startsWith(`${home()}/`) ? `~${file.slice(home().length)}` : file;
}

/** The server's name in agents' configuration, for this Ri. */
export function localServerName(): string {
  return personalMcpNames(homeEnvironment()).server;
}

/** This Ri's MCP address on this computer: loopback, so it works without a remote address. */
export function localMcpUrl(): string {
  return homeMcpAddress(null, getLocalBaseUrl()).mcpUrl;
}

function run(command: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    // No shell: arguments go to the program as they are, and nothing is
    // recorded in a shell's history.
    execFile(untraced(command), args, { timeout: timeoutMs, env: process.env, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new LocalSetupError('failed', (stderr || stdout || error.message).trim().split('\n').slice(-3).join(' ')));
      else resolve(stdout);
    });
  });
}

// ─── Configuration files ───────────────────────────────────────

const FORMAT: jsonc.FormattingOptions = { insertSpaces: true, tabSize: 2, eol: '\n' };

/** A file's text and parsed value. A missing or empty file reads as `{}`. */
function readJsonFile(file: string): { text: string; value: Record<string, unknown> } {
  let text = '';
  try {
    text = fs.readFileSync(/* turbopackIgnore: true */ file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!text.trim()) return { text: '{}\n', value: {} };
  const errors: jsonc.ParseError[] = [];
  const value = jsonc.parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0 || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LocalSetupError('conflict', `${displayPath(file)} isn’t valid JSON, so Ri left it alone. Fix it, then try again.`);
  }
  return { text, value: value as Record<string, unknown> };
}

/**
 * Write a file that holds a key: only its owner can read it, and it's
 * replaced whole, so a reader never sees half of it. A linked file (a
 * dotfiles folder) is written where it really is, keeping the link.
 */
function writePrivateFile(file: string, text: string): void {
  let real = file;
  try { real = fs.realpathSync(/* turbopackIgnore: true */ file); } catch { /* New file. */ }
  fs.mkdirSync(path.dirname(real), { recursive: true });
  const staging = path.join(/* turbopackIgnore: true */ path.dirname(real), `.${path.basename(real)}.${process.pid}.ri-tmp`);
  fs.writeFileSync(/* turbopackIgnore: true */ staging, text, { mode: 0o600 });
  fs.renameSync(staging, real);
  fs.chmodSync(/* turbopackIgnore: true */ real, 0o600);
}

function serverEntry(value: Record<string, unknown>, root: string, server: string): Record<string, unknown> | null {
  const servers = value[root];
  if (!servers || typeof servers !== 'object') return null;
  const entry = (servers as Record<string, unknown>)[server];
  return entry && typeof entry === 'object' ? entry as Record<string, unknown> : null;
}

/** Set or remove (`undefined`) Ri's entry, leaving the rest of the file as it was. */
function editJsonFile(file: string, root: string, server: string, entry: Record<string, unknown> | undefined): void {
  const { text, value } = readJsonFile(file);
  if (entry === undefined && !serverEntry(value, root, server)) return;
  const edits = jsonc.modify(text, [root, server], entry, { formattingOptions: FORMAT });
  writePrivateFile(file, jsonc.applyEdits(text, edits));
}

// ─── Each agent ────────────────────────────────────────────────

/** What Ri finds under its server name: the address it points at and the key it sends. */
type Entry = { url: string | null; token: string | null };

interface Adapter {
  /** The agent's program here, `''` for an app with nothing to run, or null when it isn't here. */
  detect(): Promise<string | null>;
  file(): string;
  read(server: string, command: string): Promise<Entry | null>;
  write(server: string, url: string, token: string, command: string): Promise<void>;
  remove(server: string, command: string): Promise<void>;
}

/**
 * A harness's program, found the way the harness registry runs it: its
 * command override (`CLAUDE_COMMAND` and the like) or its program on PATH and
 * in the folders its installer uses, through agentex's own lookup. No
 * capability probe, since setting it up needs only the program.
 */
async function harnessCommand(client: AiClientDef): Promise<string | null> {
  if (!client.harness) return null;
  const override = process.env[HARNESS_REGISTRY[client.harness].commandEnv]?.trim();
  try {
    return (await findBinary(HARNESS_COMMANDS[client.harness], override || undefined)).bin;
  } catch {
    return null;
  }
}

const HARNESS_COMMANDS = { claude: 'claude', codex: 'codex', cursor: 'agent', opencode: 'opencode', antigravity: 'agy' } as const satisfies Record<HarnessId, string>;

async function onPath(name: string): Promise<string | null> {
  try {
    return (await findBinary(name)).bin;
  } catch {
    return null;
  }
}

/** An app's evidence on this computer: its bundle, its program or its own folder. */
function present(paths: Array<string | null>): boolean {
  return paths.some(p => p !== null && fs.existsSync(/* turbopackIgnore: true */ expandPath(p)));
}

function jsonAdapter(config: AiClientJsonConfig, detect: () => Promise<string | null>): Adapter {
  const file = () => expandPath(clientFilePath(config.file, process.platform));
  return {
    detect,
    file,
    read: async (server) => {
      const entry = serverEntry(readJsonFile(file()).value, config.root, server);
      return entry ? config.read(entry) : null;
    },
    write: async (server, url, token) => editJsonFile(file(), config.root, server, config.entry(url, token)),
    remove: async (server) => editJsonFile(file(), config.root, server, undefined),
  };
}

const mac = process.platform === 'darwin';
const app = (name: string) => (mac ? `/Applications/${name}.app` : null);
const appOrFolder = (bundle: string, folder: string) => async () => (present([app(bundle), folder]) ? '' : null);

function claudeAdapter(client: AiClientDef): Adapter {
  // Claude Code keeps user-scope servers in its own `.claude.json`, which
  // `claude mcp add` writes. Reading it needs no process and no network.
  const file = () => path.join(/* turbopackIgnore: true */ process.env.CLAUDE_CONFIG_DIR || home(), '.claude.json');
  const config = client.local!.config as AiClientJsonConfig;
  return {
    detect: () => harnessCommand(client),
    file,
    read: async (server) => {
      const entry = serverEntry(readJsonFile(file()).value, 'mcpServers', server);
      return entry ? config.read(entry) : null;
    },
    write: async (server, url, token, command) => {
      await run(command, ['mcp', 'remove', '--scope', 'user', server]).catch(() => undefined);
      await run(command, ['mcp', 'add', '--transport', 'http', '--scope', 'user', server, url, '--header', `Authorization: Bearer ${token}`]);
    },
    remove: async (server, command) => {
      await run(command, ['mcp', 'remove', '--scope', 'user', server]);
    },
  };
}

/**
 * Codex's tables for a server: its own, `[mcp_servers.<server>]`, and any
 * under it (`.http_headers`, `.env`), each running to the next table header.
 */
export function withoutCodexTables(text: string, server: string): string {
  const name = server.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ours = new RegExp(`^\\s*\\[\\s*mcp_servers\\.(?:${name}|"${name}")(?:\\.[^\\]]*)?\\s*\\]\\s*(?:#.*)?$`);
  const header = /^\s*\[/;
  const kept: string[] = [];
  let skipping = false;
  for (const line of text.split('\n')) {
    if (header.test(line)) skipping = ours.test(line);
    if (!skipping) kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Codex: Ri's table goes at the end of `config.toml` with the key as a static
 * header (`http_headers`), which the Codex CLI and app both read without any
 * environment variable. Ri adds and removes only its own tables, so the rest
 * of the file stays byte for byte (`codex mcp add` would rewrite every other
 * server). `codex mcp get --json` reads the result back with Codex's own
 * parser, and a file Codex couldn't read is put back as it was.
 */
function codexAdapter(client: AiClientDef): Adapter {
  const file = () => path.join(/* turbopackIgnore: true */ process.env.CODEX_HOME || path.join(home(), '.codex'), 'config.toml');
  const current = () => {
    try { return fs.readFileSync(/* turbopackIgnore: true */ file(), 'utf8'); } catch { return ''; }
  };
  const read = async (server: string, command: string): Promise<Entry | null> => {
    let output: string;
    try {
      output = await run(command, ['mcp', 'get', server, '--json'], 15_000);
    } catch {
      return null;
    }
    const parsed = JSON.parse(output) as { transport?: { url?: string; http_headers?: Record<string, string> | null } };
    const authorization = parsed.transport?.http_headers?.Authorization;
    return {
      url: parsed.transport?.url ?? null,
      token: authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null,
    };
  };
  return {
    detect: () => harnessCommand(client),
    file,
    read,
    write: async (server, url, token, command) => {
      const before = current();
      const rest = withoutCodexTables(before, server).replace(/\n*$/, '');
      writePrivateFile(file(), `${rest ? `${rest}\n\n` : ''}${codexTable(server, url, token)}\n`);
      const check = await read(server, command);
      if (check?.token !== token || check.url !== url) {
        writePrivateFile(file(), before);
        throw new LocalSetupError('failed', `Codex couldn’t read Ri’s entry in ${displayPath(file())}, so Ri put the file back as it was.`);
      }
    },
    remove: async (server) => {
      const before = current();
      const after = withoutCodexTables(before, server);
      if (after !== before) writePrivateFile(file(), after.replace(/\n*$/, '\n'));
    },
  };
}

/** Antigravity: `agy mcp add` writes the file, which it leaves readable by others, so Ri narrows it to its owner. */
function antigravityAdapter(client: AiClientDef): Adapter {
  const config = client.local!.config as AiClientJsonConfig;
  const base = jsonAdapter(config, () => harnessCommand(client));
  return {
    ...base,
    write: async (server, url, token, command) => {
      await run(command, ['mcp', 'add', '--header', `Authorization: Bearer ${token}`, server, url]);
      fs.chmodSync(/* turbopackIgnore: true */ base.file(), 0o600);
    },
    remove: async (server, command) => {
      await run(command, ['mcp', 'remove', server]);
    },
  };
}

function adapterFor(client: AiClientDef): Adapter | null {
  const local = client.local;
  if (!local) return null;
  switch (client.kind) {
    case 'claude_code': return claudeAdapter(client);
    case 'codex': return codexAdapter(client);
    case 'antigravity': return antigravityAdapter(client);
    default: break;
  }
  if (local.config === 'codex') return null;
  const config = local.config;
  switch (client.kind) {
    case 'cursor': return jsonAdapter(config, async () => (await harnessCommand(client)) ?? (present([app('Cursor'), '~/.cursor']) ? '' : null));
    case 'vscode': return jsonAdapter(config, async () => (present([app('Visual Studio Code'), clientFilePath(config.file, process.platform).replace(/\/mcp\.json$/, '')]) ? '' : await onPath('code')));
    case 'claude_desktop': return jsonAdapter(config, async () => (present([app('Claude')]) && (await onPath('npx')) ? '' : null));
    case 'gemini_cli': return jsonAdapter(config, () => onPath('gemini'));
    case 'opencode': return jsonAdapter(config, () => harnessCommand(client));
    case 'kiro': return jsonAdapter(config, appOrFolder('Kiro', '~/.kiro'));
    default: return null;
  }
}

/** The agents Ri can set up on this computer. */
export const LOCAL_CLIENTS: readonly AiClientKind[] = AI_CLIENTS.filter(client => client.local).map(client => client.kind);

function localAdapter(kind: AiClientKind): { client: AiClientDef; adapter: Adapter } {
  const client = aiClient(kind);
  const adapter = adapterFor(client);
  if (!adapter) throw new LocalSetupError('unsupported', `Ri can’t set up ${client.label} on this computer. Follow its steps in Settings → Connect your agent instead.`);
  return { client, adapter };
}

/** An entry under Ri's name is a Ri's when it points at a Ri's MCP path. */
function isRiEntry(entry: Entry): boolean {
  try {
    return entry.url !== null && new URL(entry.url).pathname === new URL(localMcpUrl()).pathname;
  } catch {
    return false;
  }
}

async function inspect(client: AiClientDef, adapter: Adapter): Promise<LocalAgentState> {
  const server = localServerName();
  const state: LocalAgentState = { kind: client.kind, installed: false, connection: null, stale: null, config: displayPath(adapter.file()) };
  const command = await adapter.detect();
  if (command === null) return state;
  state.installed = true;
  let entry: Entry | null = null;
  try {
    entry = await adapter.read(server, command);
  } catch {
    // An unreadable file reads as not connected here. Set up says why.
  }
  if (!entry) return state;
  const connection = entry.token ? q.findPersonalAiClientByToken(entry.token) : null;
  if (connection) state.connection = connection;
  else state.stale = isRiEntry(entry) ? 'revoked' : 'elsewhere';
  return state;
}

/** Every agent Ri can set up here, whether it's installed and whether it's connected. */
export async function listLocalAgents(): Promise<LocalAgentState[]> {
  assertPersonalCapability('Personal external assistants');
  return Promise.all(LOCAL_CLIENTS.map(async (kind) => {
    const { client, adapter } = localAdapter(kind);
    return inspect(client, adapter);
  }));
}

export async function localAgentState(kind: AiClientKind): Promise<LocalAgentState> {
  assertPersonalCapability('Personal external assistants');
  const { client, adapter } = localAdapter(kind);
  return inspect(client, adapter);
}

function skillFolders(client: AiClientDef): SkillFolder[] {
  return client.skills.map(({ dir, links }) => ({ folder: path.join(/* turbopackIgnore: true */ home(), dir), links }));
}

/** What to do after setting an agent up, to load the change. */
function nextStep(client: AiClientDef, server: string): string {
  switch (client.kind) {
    case 'claude_code': return `Start a new Claude Code session. Run /mcp there to see ${server}.`;
    case 'codex': return `Start a new Codex session, in the CLI or the Codex app. Run /mcp there to see ${server}.`;
    case 'cursor': return `Open Cursor Settings → MCP and turn ${server} on if Cursor asks. The Cursor CLI picks it up in its next session.`;
    case 'vscode': return `In VS Code, start ${server} from the MCP servers list, or trust it when Copilot asks.`;
    case 'claude_desktop': return 'Quit and reopen the Claude app.';
    case 'gemini_cli': return `Start a new Gemini CLI session. Run /mcp there to see ${server}.`;
    case 'windsurf': return 'Refresh the MCP servers panel in Windsurf’s Cascade.';
    case 'opencode': return 'Start a new OpenCode session.';
    case 'antigravity': return 'Start a new Antigravity conversation.';
    case 'kiro': return `Check that ${server} is connected in Kiro’s MCP servers panel.`;
    case 'lm_studio': return 'Restart LM Studio, then use a model that supports tools.';
    default: return 'Restart it to load the change.';
  }
}

/**
 * Connect an agent on this computer, replacing any earlier entry of a Ri's
 * under the same name. The new key is made first and revoked again if the
 * agent's configuration can't be written, so a failure leaves no working key
 * behind. An earlier key this Ri wrote there is revoked once the new one is in.
 */
export async function connectLocalAgent(kind: AiClientKind): Promise<LocalConnectResult> {
  assertPersonalCapability('Personal external assistants');
  const { client, adapter } = localAdapter(kind);
  const command = await adapter.detect();
  if (command === null) {
    throw new LocalSetupError('not_installed', `${client.label} isn’t installed on this computer. Install it, or follow its steps to connect it on another computer.`);
  }
  const server = localServerName();
  const url = localMcpUrl();
  const before = await adapter.read(server, command).catch((error: unknown) => {
    if (error instanceof LocalSetupError) throw error;
    return null;
  });
  const previous = before?.token ? q.findPersonalAiClientByToken(before.token) : null;
  if (before && !previous && !isRiEntry(before)) {
    throw new LocalSetupError('conflict', `${displayPath(adapter.file())} already has a server named ${server} that isn’t Ri’s, so Ri left it alone. Rename or remove it, then try again.`);
  }

  const { client: connection, token } = q.createPersonalAiClient(`${client.keyName} on ${defaultDeviceName()}`.slice(0, q.AI_CLIENT_NAME_MAX), kind);
  try {
    await adapter.write(server, url, token.plaintext, command);
  } catch (error) {
    q.revokePersonalAiClient(connection.keyId);
    if (error instanceof LocalSetupError) throw error;
    throw new LocalSetupError('failed', `Could not add Ri to ${client.label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (previous && previous.keyId !== connection.keyId) q.revokePersonalAiClient(previous.keyId);

  return { kind, connection, config: displayPath(adapter.file()), server, skills: await installClientSkills(client), next: nextStep(client, server) };
}

/** Ri's skills in the agent's own skill folders. A skill problem never undoes the connection. */
async function installClientSkills(client: AiClientDef): Promise<LocalConnectResult['skills']> {
  const folders = skillFolders(client);
  if (folders.length === 0) return { state: 'none', blocked: [] };
  try {
    const before = inspectSkillFolders(folders);
    if (!before.ready) await installGlobalSkills(folders);
    const after = inspectSkillFolders(folders);
    return { state: after.ready ? 'ready' : 'blocked', blocked: after.blocked };
  } catch {
    return { state: 'blocked', blocked: [] };
  }
}

/**
 * Disconnect an agent on this computer: remove the entry Ri wrote and revoke
 * its key. An entry that isn't a Ri's stays. Ri's skills stay too, since the
 * agent can still use them through the `ri` command here.
 */
export async function disconnectLocalAgent(kind: AiClientKind): Promise<{ removed: boolean; revoked: boolean }> {
  assertPersonalCapability('Personal external assistants');
  const { adapter } = localAdapter(kind);
  const command = await adapter.detect();
  const server = localServerName();
  const entry = command === null ? null : await adapter.read(server, command).catch(() => null);
  if (!entry || command === null) return { removed: false, revoked: false };
  const key = entry.token ? q.findPersonalAiClientByToken(entry.token) : null;
  if (!key && !isRiEntry(entry)) {
    throw new LocalSetupError('conflict', `The ${server} server in ${displayPath(adapter.file())} isn’t Ri’s, so Ri left it alone.`);
  }
  await adapter.remove(server, command);
  if (key) q.revokePersonalAiClient(key.keyId);
  return { removed: true, revoked: Boolean(key) };
}
