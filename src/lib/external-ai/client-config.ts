/**
 * Every outside agent listed in Settings → Connect your agent, most popular
 * first, and how each one reaches Ri's MCP: its steps by hand on any computer,
 * its one-click install link when it has one, the prompt an agent can follow to
 * set itself up, and, for the computer running Ri, where Ri writes its
 * configuration in one action (`local-setup.ts` does the writing). Pure, so the
 * settings list, the server, the CLI and the tests share one source. Both a
 * personal Ri and a team use it, with their own address and names.
 *
 * Where the key goes, everywhere: in the agent's own user-level configuration
 * (the file it reads, at mode 600 when Ri writes it) or, for the CLI steps a
 * person follows, in an environment variable set in their shell profile. Never
 * in a project's files, and never typed into a command, so it stays out of
 * shell history. Each agent's format was checked against its own docs and,
 * where it's installed here, its CLI (docs/external-ai.md lists the sources).
 */

import type { HarnessId, HarnessLogoId } from '@/lib/harness/registry';

export type AiClientKind =
  | 'claude_code'
  | 'codex'
  | 'cursor'
  | 'vscode'
  | 'claude_desktop'
  | 'gemini_cli'
  | 'windsurf'
  | 'opencode'
  | 'antigravity'
  | 'goose'
  | 'kiro'
  | 'lm_studio'
  | 'chatgpt'
  | 'ri'
  | 'other';

/** The mark each agent is drawn with (`src/components/settings/ai-client-logo.tsx`). */
export type AiClientLogoId = HarnessLogoId | 'vscode' | 'gemini' | 'windsurf' | 'goose' | 'kiro' | 'lmstudio' | 'openai' | 'ri' | 'mcp';

/** An agent's own configuration file, `~` for the home folder. */
export interface AiClientFile {
  darwin: string;
  linux: string;
  win32: string;
}

/**
 * A configuration file Ri edits in place: the entry under `root` named after
 * the server. Comments and everything else in the file stay as they are.
 */
export interface AiClientJsonConfig {
  file: AiClientFile;
  root: 'mcpServers' | 'servers' | 'mcp';
  /** The server's entry, holding the key. */
  entry(url: string, token: string): Record<string, unknown>;
  /** An entry read back: the address it points at and the key it sends. */
  read(entry: Record<string, unknown>): { url: string | null; token: string | null };
}

/** How Ri sets an agent up on the computer running Ri, in one action. */
export type AiClientLocalSetup =
  /** Through the agent's own CLI (`claude mcp add`, `codex mcp add`, `agy mcp add`). */
  | { via: 'cli'; config: AiClientJsonConfig | 'codex' }
  /** By editing its configuration file. */
  | { via: 'file'; config: AiClientJsonConfig };

export interface AiClientDef {
  kind: AiClientKind;
  label: string;
  /** One line under the name. */
  blurb: string;
  logo: AiClientLogoId;
  /** The harness Ri runs it as, whose detection says whether it's installed here. */
  harness: HarnessId | null;
  /** Ri can set it up on this computer. */
  local: AiClientLocalSetup | null;
  /**
   * Its user-level skill folders, under the home folder, and whether a skill
   * there can be a link. Connecting it here puts Ri's skills in them.
   */
  skills: Array<{ dir: string; links: boolean }>;
  docsUrl: string;
  /** Why it can't be connected yet. Set only for an agent that can't. */
  limitation?: string;
  /** The key's name in Settings, and in Ri's own key list. */
  keyName: string;
}

const bearer = (token: string) => `Bearer ${token}`;
const tokenOf = (value: unknown) => typeof value === 'string' && value.startsWith('Bearer ') ? value.slice('Bearer '.length) : null;
const stringOf = (value: unknown) => typeof value === 'string' ? value : null;
const headersOf = (entry: Record<string, unknown>) =>
  entry.headers && typeof entry.headers === 'object' ? entry.headers as Record<string, unknown> : {};

/** `{ url, headers }`, the shape most agents read. */
function urlEntry(file: AiClientFile, extra: Record<string, unknown> = {}): AiClientJsonConfig {
  return {
    file,
    root: 'mcpServers',
    entry: (url, token) => ({ ...extra, url, headers: { Authorization: bearer(token) } }),
    read: entry => ({ url: stringOf(entry.url), token: tokenOf(headersOf(entry).Authorization) }),
  };
}

const sameEverywhere = (file: string): AiClientFile => ({ darwin: file, linux: file, win32: file });

/** Claude Code keeps user-scope servers in `~/.claude.json`, which `claude mcp add` writes. */
export const CLAUDE_CODE_CONFIG: AiClientJsonConfig = {
  ...urlEntry(sameEverywhere('~/.claude.json'), { type: 'http' }),
};

export const CURSOR_CONFIG = urlEntry(sameEverywhere('~/.cursor/mcp.json'));

export const VSCODE_CONFIG: AiClientJsonConfig = {
  file: {
    darwin: '~/Library/Application Support/Code/User/mcp.json',
    linux: '~/.config/Code/User/mcp.json',
    win32: '%APPDATA%\\Code\\User\\mcp.json',
  },
  root: 'servers',
  entry: (url, token) => ({ type: 'http', url, headers: { Authorization: bearer(token) } }),
  read: entry => ({ url: stringOf(entry.url), token: tokenOf(headersOf(entry).Authorization) }),
};

/**
 * The Claude app's own connectors are reached from Anthropic's cloud, which
 * can't see this computer, and take a key only in a limited beta. So it
 * reaches Ri through mcp-remote, a local bridge started with Node.js. The key
 * travels in an environment variable the bridge reads (no space after the
 * colon, which some apps would split on), never in its arguments.
 */
export const CLAUDE_DESKTOP_CONFIG: AiClientJsonConfig = {
  file: {
    darwin: '~/Library/Application Support/Claude/claude_desktop_config.json',
    linux: '~/.config/Claude/claude_desktop_config.json',
    win32: '%APPDATA%\\Claude\\claude_desktop_config.json',
  },
  root: 'mcpServers',
  entry: (url, token) => ({
    command: 'npx',
    args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${RI_AUTH_HEADER}', '--transport', 'http-only'],
    env: { RI_AUTH_HEADER: bearer(token) },
  }),
  read: entry => {
    const args = Array.isArray(entry.args) ? entry.args.filter((arg): arg is string => typeof arg === 'string') : [];
    const env = entry.env && typeof entry.env === 'object' ? entry.env as Record<string, unknown> : {};
    return { url: args.find(arg => /^https?:\/\//.test(arg)) ?? null, token: tokenOf(env.RI_AUTH_HEADER) };
  },
};

/** `type: "http"` with `url`, which `gemini mcp add` writes. `httpUrl` is deprecated. */
export const GEMINI_CLI_CONFIG: AiClientJsonConfig = {
  file: sameEverywhere('~/.gemini/settings.json'),
  root: 'mcpServers',
  entry: (url, token) => ({ type: 'http', url, headers: { Authorization: bearer(token) } }),
  read: entry => ({ url: stringOf(entry.httpUrl) ?? stringOf(entry.url), token: tokenOf(headersOf(entry).Authorization) }),
};

/**
 * Windsurf became Devin Desktop in June 2026 and moved this file to
 * `~/.config/devin/mcp_config.json`. Which one an install reads isn't
 * documented, so Ri doesn't write it on its own: the steps say where.
 */
export const WINDSURF_CONFIG: AiClientJsonConfig = {
  file: sameEverywhere('~/.config/devin/mcp_config.json'),
  root: 'mcpServers',
  entry: (url, token) => ({ serverUrl: url, headers: { Authorization: bearer(token) } }),
  read: entry => ({ url: stringOf(entry.serverUrl) ?? stringOf(entry.url), token: tokenOf(headersOf(entry).Authorization) }),
};

export const OPENCODE_CONFIG: AiClientJsonConfig = {
  file: sameEverywhere('~/.config/opencode/opencode.json'),
  root: 'mcp',
  // `oauth: false`: OpenCode would otherwise try an OAuth sign-in Ri doesn't offer.
  entry: (url, token) => ({ type: 'remote', url, enabled: true, oauth: false, headers: { Authorization: bearer(token) } }),
  read: entry => ({ url: stringOf(entry.url), token: tokenOf(headersOf(entry).Authorization) }),
};

/** The Antigravity CLI (`agy mcp add`) and app read `serverUrl` here. */
export const ANTIGRAVITY_CONFIG: AiClientJsonConfig = {
  file: sameEverywhere('~/.gemini/config/mcp_config.json'),
  root: 'mcpServers',
  entry: (url, token) => ({ serverUrl: url, headers: { Authorization: bearer(token) } }),
  read: entry => ({ url: stringOf(entry.serverUrl) ?? stringOf(entry.url), token: tokenOf(headersOf(entry).Authorization) }),
};

export const KIRO_CONFIG = urlEntry(sameEverywhere('~/.kiro/settings/mcp.json'));

/** LM Studio follows Cursor's format. Its file's place isn't documented, so its own menu opens it. */
export const LM_STUDIO_CONFIG = urlEntry(sameEverywhere('~/.lmstudio/mcp.json'));

export const AI_CLIENTS: readonly AiClientDef[] = [
  {
    kind: 'claude_code', label: 'Claude Code', blurb: 'Anthropic’s coding agent, in a terminal or your editor', logo: 'claude', harness: 'claude',
    local: { via: 'cli', config: CLAUDE_CODE_CONFIG }, skills: [{ dir: '.claude/skills', links: true }],
    docsUrl: 'https://code.claude.com/docs/en/mcp', keyName: 'Claude Code',
  },
  {
    kind: 'codex', label: 'Codex', blurb: 'OpenAI’s coding agent, the CLI and Codex in the ChatGPT app', logo: 'codex', harness: 'codex',
    local: { via: 'cli', config: 'codex' }, skills: [{ dir: '.agents/skills', links: true }],
    docsUrl: 'https://learn.chatgpt.com/docs/extend/mcp', keyName: 'Codex',
  },
  {
    kind: 'cursor', label: 'Cursor', blurb: 'The Cursor editor and its CLI', logo: 'cursor', harness: 'cursor',
    local: { via: 'file', config: CURSOR_CONFIG }, skills: [{ dir: '.agents/skills', links: true }],
    docsUrl: 'https://cursor.com/docs/context/mcp', keyName: 'Cursor',
  },
  {
    kind: 'vscode', label: 'VS Code', blurb: 'GitHub Copilot’s agent mode', logo: 'vscode', harness: null,
    local: { via: 'file', config: VSCODE_CONFIG }, skills: [{ dir: '.agents/skills', links: true }],
    docsUrl: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration', keyName: 'VS Code',
  },
  {
    kind: 'claude_desktop', label: 'Claude app', blurb: 'Claude on your desktop, through a small bridge', logo: 'claude', harness: null,
    local: { via: 'file', config: CLAUDE_DESKTOP_CONFIG }, skills: [],
    docsUrl: 'https://modelcontextprotocol.io/docs/develop/connect-local-servers', keyName: 'Claude app',
  },
  {
    kind: 'gemini_cli', label: 'Gemini CLI', blurb: 'Google’s Gemini agent in a terminal', logo: 'gemini', harness: null,
    local: { via: 'file', config: GEMINI_CLI_CONFIG }, skills: [{ dir: '.agents/skills', links: true }],
    docsUrl: 'https://geminicli.com/docs/tools/mcp-server/', keyName: 'Gemini CLI',
  },
  {
    kind: 'windsurf', label: 'Windsurf', blurb: 'Cascade in Devin Desktop, Windsurf’s new name', logo: 'windsurf', harness: null,
    local: null, skills: [],
    docsUrl: 'https://docs.devin.ai/desktop/cascade/mcp', keyName: 'Windsurf',
  },
  {
    kind: 'opencode', label: 'OpenCode', blurb: 'The open source coding agent', logo: 'opencode', harness: 'opencode',
    local: { via: 'file', config: OPENCODE_CONFIG }, skills: [{ dir: '.agents/skills', links: true }],
    docsUrl: 'https://opencode.ai/docs/mcp-servers/', keyName: 'OpenCode',
  },
  {
    kind: 'antigravity', label: 'Antigravity', blurb: 'Google’s agent editor and its CLI', logo: 'antigravity', harness: 'antigravity',
    local: { via: 'cli', config: ANTIGRAVITY_CONFIG }, skills: [{ dir: '.gemini/config/skills', links: false }],
    docsUrl: 'https://antigravity.google/docs/mcp', keyName: 'Antigravity',
  },
  {
    kind: 'goose', label: 'Goose', blurb: 'The open source agent, on your desktop or in a terminal', logo: 'goose', harness: null,
    local: null, skills: [],
    docsUrl: 'https://github.com/aaif-goose/goose/blob/main/documentation/docs/getting-started/using-extensions.md', keyName: 'Goose',
  },
  {
    kind: 'kiro', label: 'Kiro', blurb: 'The agentic editor from AWS', logo: 'kiro', harness: null,
    local: { via: 'file', config: KIRO_CONFIG }, skills: [],
    docsUrl: 'https://kiro.dev/docs/mcp/configuration/', keyName: 'Kiro',
  },
  {
    kind: 'lm_studio', label: 'LM Studio', blurb: 'Local models that can use tools', logo: 'lmstudio', harness: null,
    local: null, skills: [],
    docsUrl: 'https://lmstudio.ai/docs/app/mcp', keyName: 'LM Studio',
  },
  {
    kind: 'chatgpt', label: 'ChatGPT', blurb: 'Not available yet', logo: 'openai', harness: null, local: null, skills: [],
    docsUrl: 'https://developers.openai.com/apps-sdk/deploy/connect-chatgpt', keyName: 'ChatGPT',
    limitation: 'ChatGPT connects to an MCP server only with an OAuth sign-in or with no sign-in at all, and from OpenAI’s cloud, so it can’t use a key. Ri doesn’t offer OAuth yet. Codex in the ChatGPT app does connect: use Codex above.',
  },
  {
    kind: 'ri', label: 'Another Ri', blurb: 'Use this work from a different Ri', logo: 'ri', harness: null, local: null, skills: [],
    docsUrl: '', keyName: 'Another Ri',
  },
  {
    kind: 'other', label: 'Any MCP client', blurb: 'Streamable HTTP with a bearer key', logo: 'mcp', harness: null, local: null, skills: [],
    docsUrl: 'https://modelcontextprotocol.io/docs/learn/transports#streamable-http', keyName: 'MCP client',
  },
];

export function aiClient(kind: AiClientKind): AiClientDef {
  return AI_CLIENTS.find(client => client.kind === kind)!;
}

export function isAiClientKind(value: unknown): value is AiClientKind {
  return typeof value === 'string' && AI_CLIENTS.some(client => client.kind === value);
}

/**
 * The agent a key belongs to. Keys made before agents were recorded fall back
 * to their name when it was a client's default one, and to any MCP client.
 */
export function aiClientOfKey(key: { client: string | null; name: string }): AiClientKind {
  if (isAiClientKind(key.client)) return key.client;
  const legacy: Record<string, AiClientKind> = { 'Claude Code': 'claude_code', Codex: 'codex', 'My Ri': 'ri' };
  return legacy[key.name] ?? 'other';
}

/** The config file path for this platform, as people read it. */
export function clientFilePath(file: AiClientFile, platform: string = 'darwin'): string {
  return platform === 'win32' ? file.win32 : platform === 'linux' ? file.linux : file.darwin;
}

/** Stable server and environment-variable names. Retains the team's existing naming contract. */
export function teamMcpNames(teamName: string): { server: string; tokenVar: string } {
  const slug = teamName
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
    .replace(/_+$/g, '')
    .toUpperCase();
  const name = slug || 'TEAM';
  return { server: `ri-${name.toLowerCase().replace(/_/g, '-')}`, tokenVar: `RI_${name}_TOKEN` };
}

/**
 * A personal Ri is `ri` in an agent's configuration. A development Ri is
 * `ri-dev`, so trying a change never replaces the connection to the real one.
 */
export function personalMcpNames(environment: 'production' | 'development'): { server: string; tokenVar: string } {
  return environment === 'development'
    ? { server: 'ri-dev', tokenVar: 'RI_DEV_MCP_TOKEN' }
    : { server: 'ri', tokenVar: 'RI_MCP_TOKEN' };
}

/** Where a connection points, and its names in an agent's configuration. */
export interface AiConnectionTarget {
  space: { kind: 'personal' } | { kind: 'team'; name: string };
  mcpUrl: string;
  server: string;
  tokenVar: string;
}

export function teamConnectionTarget(teamName: string, mcpUrl: string): AiConnectionTarget {
  return { space: { kind: 'team', name: teamName }, mcpUrl, ...teamMcpNames(teamName) };
}

/** Shown where the key goes until one is made. */
export const KEY_PLACEHOLDER = '<your key>';

export interface AiClientSetupStep {
  /** What to do with the text. */
  label: string;
  /** Exactly what to copy. */
  text: string;
  /** The text holds the key, so it waits for one. */
  secret?: boolean;
}

export interface AiClientSetup {
  steps: AiClientSetupStep[];
  /** What to do after the steps, or a limitation to know about. */
  caveat: string | null;
}

/** A value inside single quotes in a POSIX shell. */
function quoted(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A TOML basic string. JSON's escapes are TOML's for the characters a URL or key holds. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

/** Codex's table for Ri, with the key as a static header (`http_headers`), which the CLI and the app both read. */
export function codexTable(server: string, url: string, token: string): string {
  return `[mcp_servers.${server}]\nurl = ${tomlString(url)}\nhttp_headers = { Authorization = ${tomlString(bearer(token))} }`;
}


/** The whole file for an agent that reads JSON, with only Ri's server in it. */
function jsonSnippet(config: AiClientJsonConfig, server: string, url: string, token: string, top: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...top, [config.root]: { [server]: config.entry(url, token) } }, null, 2);
}

function whose(target: AiConnectionTarget): string {
  return target.space.kind === 'personal' ? 'your Ri' : target.space.name;
}

/**
 * The steps a person follows by hand, on any computer. With no token yet,
 * the key's place shows `KEY_PLACEHOLDER` and its step is marked `secret`.
 */
export function aiClientSetup(kind: AiClientKind, target: AiConnectionTarget, token: string | null = null): AiClientSetup {
  const key = token ?? KEY_PLACEHOLDER;
  const { server, tokenVar, mcpUrl: url } = target;
  const profileStep: AiClientSetupStep = {
    label: 'Add this line to your shell profile (~/.zshrc on a Mac, ~/.bashrc on Linux) in an editor. It keeps the key out of your projects and shell history.',
    text: `export ${tokenVar}=${quoted(key)}`,
    secret: true,
  };
  const fileStep = (config: AiClientJsonConfig, where: string, top?: Record<string, unknown>): AiClientSetupStep => ({
    label: `Add this to ${where} in an editor, merging it with what’s there. Create the file if it’s missing.`,
    text: jsonSnippet(config, server, url, key, top),
    secret: true,
  });
  switch (kind) {
    case 'claude_code':
      return {
        steps: [
          profileStep,
          {
            label: `Then, in a new terminal, add ${whose(target)} to Claude Code for all your projects.`,
            text: `claude mcp add --transport http --scope user ${server} ${quoted(url)} --header 'Authorization: Bearer \${${tokenVar}}'`,
          },
        ],
        caveat: `Start Claude Code and run /mcp to check that ${server} is connected. The Claude desktop app is set up on its own, under Claude app.`,
      };
    case 'codex':
      return {
        steps: [{
          label: 'Add this to the end of ~/.codex/config.toml in an editor. The Codex CLI and the Codex app both read it.',
          text: codexTable(server, url, key),
          secret: true,
        }],
        caveat: `If the file already has an [mcp_servers.${server}] table, replace it. Then start a new Codex session and run /mcp to check that ${server} is there.`,
      };
    case 'cursor':
      return {
        steps: [fileStep(CURSOR_CONFIG, '~/.cursor/mcp.json')],
        caveat: `The Cursor editor and its CLI both read this file. Check that ${server} is on in Cursor Settings, under MCP.`,
      };
    case 'vscode':
      return {
        steps: [{
          label: 'Or run MCP: Open User Configuration from the Command Palette, and add this server to the file.',
          text: jsonSnippet(VSCODE_CONFIG, server, url, key),
          secret: true,
        }],
        caveat: `For GitHub Copilot’s agent mode. Start ${server} from the file, or trust it when VS Code asks.`,
      };
    case 'claude_desktop':
      return {
        steps: [fileStep(CLAUDE_DESKTOP_CONFIG, 'the Claude app’s configuration (Settings → Developer → Edit Config)')],
        caveat: 'The Claude app connects to remote servers only through a sign-in Ri doesn’t offer yet, so it reaches Ri through mcp-remote, a small bridge started with Node.js (npx). Quit and reopen the app after saving.',
      };
    case 'gemini_cli':
      return {
        steps: [fileStep(GEMINI_CLI_CONFIG, '~/.gemini/settings.json')],
        caveat: `Start Gemini CLI and run /mcp to check that ${server} is connected.`,
      };
    case 'windsurf':
      return {
        steps: [{
          label: 'In Cascade, open the … menu → MCP servers → Open MCP config file (~/.config/devin/mcp_config.json in Devin Desktop, ~/.codeium/windsurf/mcp_config.json before it). Add this, merging it with what’s there.',
          text: jsonSnippet(WINDSURF_CONFIG, server, url, key),
          secret: true,
        }],
        caveat: 'Then refresh Cascade’s MCP servers panel.',
      };
    case 'opencode':
      return {
        steps: [fileStep(OPENCODE_CONFIG, '~/.config/opencode/opencode.json', { $schema: 'https://opencode.ai/config.json' })],
        caveat: `Start OpenCode and run opencode mcp list to check that ${server} is there.`,
      };
    case 'antigravity':
      return {
        steps: [fileStep(ANTIGRAVITY_CONFIG, '~/.gemini/config/mcp_config.json')],
        caveat: 'The Antigravity CLI reads this file. Start a new conversation to load it.',
      };
    case 'goose':
      return {
        steps: [{
          label: 'Or add this extension to ~/.config/goose/config.yaml in an editor, under extensions.',
          text: [
            `  ${server}:`,
            '    enabled: true',
            '    type: streamable_http',
            `    name: ${server}`,
            `    uri: ${url}`,
            '    headers:',
            `      Authorization: ${bearer(key)}`,
            '    timeout: 300',
          ].join('\n'),
          secret: true,
        }],
        caveat: 'Start a new Goose session to load it.',
      };
    case 'kiro':
      return {
        steps: [fileStep(KIRO_CONFIG, '~/.kiro/settings/mcp.json')],
        caveat: `Kiro picks the change up on its own. Check that ${server} is connected in its MCP servers panel.`,
      };
    case 'lm_studio':
      return {
        steps: [{
          label: 'Or open LM Studio’s Program tab → Install → Edit mcp.json, and add this server.',
          text: jsonSnippet(LM_STUDIO_CONFIG, server, url, key),
          secret: true,
        }],
        caveat: 'Use it with a model that supports tool use.',
      };
    case 'chatgpt':
      return { steps: [], caveat: aiClient('chatgpt').limitation! };
    case 'ri':
      return {
        steps: [
          {
            label: 'In the Ri you want to connect from, open Settings → Plugins → Add MCP server. Enter this Name.',
            text: target.space.kind === 'personal' ? 'My Ri' : target.space.name,
          },
          { label: 'Paste this into Server URL.', text: url },
          { label: 'Choose Bearer token under Auth (use Change if Auth is hidden), then paste this into Secret.', text: key, secret: true },
        ],
        caveat: 'Click Add and connect, then start a new chat in that Ri. The secret stays in that Ri and is not shown to the model. Your chat uses its own model access.',
      };
    case 'other':
      return {
        steps: [
          { label: 'Give your client this server address. It speaks MCP over Streamable HTTP.', text: url },
          { label: 'And send this header with every request.', text: `Authorization: ${bearer(key)}`, secret: true },
          {
            label: 'Many clients take it as JSON like this.',
            text: JSON.stringify({ mcpServers: { [server]: { type: 'http', url, headers: { Authorization: bearer(key) } } } }, null, 2),
            secret: true,
          },
        ],
        caveat: 'If your client can’t send a header, it can’t connect yet. Keep its configuration private: the key acts as you.',
      };
  }
}

/** A one-click install link, when the agent has one. It opens the agent, which asks before adding. */
export interface AiClientInstallLink {
  /** "Add to Cursor". */
  label: string;
  href: string;
}

/** Base64 of UTF-8 text, in a browser or on the server. */
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The agent's own install link, straight to the app (`cursor://`, `vscode:`,
 * `goose://`, `lmstudio://`), never through a web page, so the key in it never
 * leaves this computer.
 */
export function aiClientInstallLink(kind: AiClientKind, target: AiConnectionTarget, token: string): AiClientInstallLink | null {
  const { server, mcpUrl: url } = target;
  const authorization = bearer(token);
  switch (kind) {
    case 'cursor':
      return {
        label: 'Add to Cursor',
        href: `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(server)}&config=${encodeURIComponent(base64(JSON.stringify(CURSOR_CONFIG.entry(url, token))))}`,
      };
    case 'vscode':
      return {
        label: 'Add to VS Code',
        href: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: server, ...VSCODE_CONFIG.entry(url, token) }))}`,
      };
    case 'goose': {
      // With a header, Goose opens its extension form filled in, to confirm.
      const name = target.space.kind === 'personal' ? 'Ri' : target.space.name;
      const params = new URLSearchParams({ url, type: 'streamable_http', id: server, name, description: 'Tasks, notes and the deck in Ri', timeout: '300' });
      params.append('header', `Authorization=${authorization}`);
      return { label: 'Add to Goose', href: `goose://extension?${params.toString()}` };
    }
    // Kiro's link goes through a page on kiro.dev, which would send the key
    // to a web server, so Kiro gets Set up and its steps instead.
    case 'lm_studio':
      return {
        label: 'Add to LM Studio',
        href: `lmstudio://add_mcp?name=${encodeURIComponent(server)}&config=${encodeURIComponent(base64(JSON.stringify(LM_STUDIO_CONFIG.entry(url, token))))}`,
      };
    default:
      return null;
  }
}

/**
 * A prompt an agent on another computer can follow to connect itself: where
 * its configuration goes, with the key, and how to check it worked.
 */
export function aiClientSetupPrompt(kind: AiClientKind, target: AiConnectionTarget, token: string): string {
  const client = aiClient(kind);
  const setup = aiClientSetup(kind, target, token);
  const { server, mcpUrl: url } = target;
  const what = target.space.kind === 'personal' ? 'my Ri, the app that holds my tasks, notes and daily deck' : `${target.space.name}, my team’s tasks and notes in Ri`;
  const agent = kind === 'other' || kind === 'ri' ? 'yourself' : `${client.label} on this computer`;
  const direct = kind === 'claude_code'
    ? [`Run this yourself, without printing the key back to me: claude mcp add --transport http --scope user ${server} ${quoted(url)} --header ${quoted(`Authorization: ${bearer(token)}`)}`]
    : setup.steps.map((step, index) => `${index + 1}. ${step.label}\n\n${step.text}`);
  return [
    `Connect ${agent} to ${what}, through its MCP server.`,
    '',
    `Server name: ${server}`,
    `Address: ${url} (Streamable HTTP)`,
    `Header: Authorization: ${bearer(token)}`,
    '',
    ...direct,
    '',
    'Keep the key in your user-level configuration only, never in a project’s files, and don’t echo it in your reply. Merge with any configuration that’s already there instead of replacing it.',
    setup.caveat ?? '',
    `When it’s set up, tell me if I need to restart anything. Then use the ${server} tools to list my tasks, so we know it works.`,
  ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n').trim();
}
