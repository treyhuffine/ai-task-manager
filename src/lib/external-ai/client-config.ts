/**
 * CLI setup for an outside assistant reaching a personal Home or a team.
 * Pure, so both dialogs and their tests share the same instructions.
 *
 * The key lives in a dedicated environment variable in the member's shell
 * profile, never in a project's files, a command's arguments or shell history:
 *
 * - Claude Code stores the header with `${VAR}` unexpanded (single quotes) and
 *   expands it when it connects. Its own credential names (ANTHROPIC_API_KEY
 *   and the like) read as empty there, so the variable has a name of its own.
 * - Codex reads the bearer token from the variable it's told about
 *   (`--bearer-token-env-var`).
 */

export type AiClientKind = 'claude_code' | 'codex' | 'other';

export const AI_CLIENT_KINDS: ReadonlyArray<{ kind: AiClientKind; label: string; defaultName: string }> = [
  { kind: 'claude_code', label: 'Claude Code', defaultName: 'Claude Code' },
  { kind: 'codex', label: 'Codex', defaultName: 'Codex' },
  { kind: 'other', label: 'Another MCP client', defaultName: 'My assistant' },
];

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

export interface AiClientSetupStep {
  /** What to do with the text. */
  label: string;
  /** Exactly what to copy. */
  text: string;
}

export interface AiClientSetup {
  /** Where the key goes, then how the client finds the team. */
  steps: AiClientSetupStep[];
  /** What this client can't do, or wasn't checked doing. */
  caveat: string | null;
}

/** A value inside single quotes in a POSIX shell. */
function quoted(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function aiClientSetup(kind: AiClientKind, input: ({ teamName: string } | { homeName: string }) & { mcpUrl: string; token: string }): AiClientSetup {
  const personal = 'homeName' in input;
  const { server, tokenVar } = teamMcpNames(personal ? input.homeName : input.teamName);
  const space = personal ? 'your Home' : 'the team';
  const keyStep: AiClientSetupStep = {
    label: 'Add this line to your shell profile (~/.zshrc on a Mac, ~/.bashrc on Linux) in an editor, so the key stays out of your projects and shell history.',
    text: `export ${tokenVar}=${quoted(input.token)}`,
  };
  if (kind === 'claude_code') {
    return {
      steps: [
        keyStep,
        {
          label: `Then, in a new terminal, add ${space} to Claude Code for all your projects.`,
          text: `claude mcp add --transport http --scope user ${server} ${quoted(input.mcpUrl)} --header 'Authorization: Bearer \${${tokenVar}}'`,
        },
      ],
      caveat: 'For Claude Code in a terminal. The Claude desktop and web apps connect differently and are not set up here.',
    };
  }
  if (kind === 'codex') {
    return {
      steps: [
        keyStep,
        {
          label: `Then, in a new terminal, add ${space} to Codex.`,
          text: `codex mcp add ${server} --url ${quoted(input.mcpUrl)} --bearer-token-env-var ${tokenVar}`,
        },
      ],
      caveat: 'For the Codex CLI started from a terminal. The Codex app reads the same configuration, but may not see a variable set in your shell profile.',
    };
  }
  return {
    steps: [
      keyStep,
      {
        label: 'Then give your client this server. It speaks MCP over Streamable HTTP, with the key as a bearer token.',
        text: JSON.stringify({ mcpServers: { [server]: { type: 'http', url: input.mcpUrl, headers: { Authorization: `Bearer \${${tokenVar}}` } } } }, null, 2),
      },
    ],
    caveat: 'If your client can\'t read the key from an environment variable, keep its configuration file private: the key acts as you.',
  };
}
