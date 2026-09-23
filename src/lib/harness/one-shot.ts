/**
 * One-shot background AI calls through the user's subscription harness.
 *
 * Background features (deck generation, stream urgency, image capture
 * extraction, the NL MCP inner agent) used to call the OpenAI API directly
 * with an API key. They now route through @agentex/agent's provider CLIs
 * (Claude Code, Codex, ...) exactly like the orchestrator chat, document
 * chat, and executions do: subscription auth, no separate API billing.
 * The only direct OpenAI API use left in the app is embeddings
 * (`src/lib/embeddings/`).
 *
 * This generalizes the pattern `deriveAndSetSessionLabel` pioneered
 * (src/lib/sessions/derive-label.ts): resolve the default harness, spawn a
 * tightly-bounded `provider.execute`, read `result.summary`. On top of that
 * it adds a model tier, optional MCP attachment for tool-using calls, and a
 * structured-JSON variant with zod validation plus one retry.
 *
 * Harness resolution: `defaultHarness` from user state (the same
 * default the orchestrator chat uses), falling back to claude. Model:
 * `standard` prefers the user's `defaultModel` when it belongs to the
 * resolved provider, else the CLI's own default; `fast` uses the provider's
 * cheap alias (haiku / gpt-5.4-mini).
 *
 * Tool-using calls: pass `mcpServers` + `allowedTools`. Claude honors both
 * (strict MCP config, pre-approved tools, everything else denied
 * unattended). Codex has no MCP wiring in agentex yet
 * (`capabilities.mcp === false`) — check `harnessSupportsMcp()` at the call
 * site and fall back to a CLI-capable call (cwd at the app root, where the
 * installed AGENTS.md surface documents the action CLI) or to no tools.
 */

import {
  getProvider,
  type ExecutionResult,
  type McpServerConfig,
  type StreamEvent,
} from '@agentex/agent';
import type { z } from 'zod';
import { CHEAPEST_MODEL } from '@/lib/executor/harness';
import { modelBelongsToProvider, type ProviderId } from '@/lib/harness/options';
import { runtimeContextForHarness } from '@/lib/harness/runtime';
import { getAppRoot } from '@/lib/config/paths';
import { getUserState } from '@/lib/db/queries';

/** fast = cheap alias (haiku / gpt-5.4-mini); standard = the user's default agent model. */
export type ModelTier = 'fast' | 'standard';

const DEFAULT_DISALLOWED_TOOLS = ['Write', 'Edit', 'NotebookEdit', 'Bash'];

export interface HarnessOneShotOpts {
  /** Short tag for log/error lines, e.g. 'deck-context'. */
  label: string;
  prompt: string;
  /** Folded in above the prompt — provider CLIs take a single prompt string. */
  system?: string;
  tier?: ModelTier;
  /** Explicit model id — wins over tier resolution. */
  model?: string;
  /** Defaults to 1. Raise it for calls that need tool round-trips. */
  maxTurns?: number;
  /** Defaults to 60. */
  timeoutSec?: number;
  /** Defaults to the app data root (where the orchestrator surface lives). */
  cwd?: string;
  /** Claude-only today; check harnessSupportsMcp() before relying on tools. */
  mcpServers?: McpServerConfig[];
  allowedTools?: string[];
  /** Defaults to denying file edits and Bash. Override for calls that need them. */
  disallowedTools?: string[];
  /**
   * Defaults to true for tool-less calls (nothing to gate) and false when
   * `mcpServers` are attached (allowedTools pre-approves the safe set and
   * everything else is denied unattended).
   */
  skipPermissions?: boolean;
  onEvent?: (event: StreamEvent) => void | Promise<void>;
}

export interface HarnessOneShotResult {
  text: string;
  providerType: ProviderId;
  model: string | undefined;
  raw: ExecutionResult;
}

/** The provider id background calls run on: the user's default agent harness. */
export function resolveBackgroundHarness(): ProviderId {
  return (getUserState()?.defaultHarness as ProviderId | null) ?? 'claude';
}

/** Whether the resolved harness can attach MCP servers (Claude yes, Codex not yet). */
export function harnessSupportsMcp(providerType: ProviderId = resolveBackgroundHarness()): boolean {
  try {
    return getProvider(providerType).capabilities.mcp === true;
  } catch {
    return false;
  }
}

/**
 * Model id for a tier, or undefined to let the CLI use its own default.
 * `standard` trusts the user's default agent model only when it belongs to
 * the resolved provider — stale cross-provider state falls back cleanly.
 */
export function backgroundModelFor(providerType: ProviderId, tier: ModelTier): string | undefined {
  const preferred = getUserState()?.defaultModel?.trim() || undefined;
  const preferredValid = preferred && modelBelongsToProvider(providerType, preferred) ? preferred : undefined;
  if (tier === 'fast') return CHEAPEST_MODEL[providerType] ?? preferredValid;
  return preferredValid;
}

/** Run one bounded harness call and return its final text. Throws on failure. */
export async function runHarnessText(opts: HarnessOneShotOpts): Promise<HarnessOneShotResult> {
  const providerType = resolveBackgroundHarness();
  const model = opts.model ?? backgroundModelFor(providerType, opts.tier ?? 'fast');
  const cwd = opts.cwd ?? getAppRoot();
  const hasMcp = (opts.mcpServers?.length ?? 0) > 0;
  const skipPermissions = opts.skipPermissions ?? !hasMcp;

  const provider = getProvider(providerType);
  const runtime = await runtimeContextForHarness(providerType, { cwd });

  const result = await provider.execute({
    prompt: opts.system ? `${opts.system}\n\n---\n\n${opts.prompt}` : opts.prompt,
    ...(model ? { model } : {}),
    cwd,
    env: runtime.env,
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    config: {
      ...runtime.config,
      timeoutSec: opts.timeoutSec ?? 60,
      maxTurns: opts.maxTurns ?? 1,
      // Ambient MCP (a stray .mcp.json, user-scope servers) must never leak
      // into a background call — its surface is exactly what we attach.
      strictMcpConfig: true,
      ...(hasMcp ? { mcpServers: opts.mcpServers } : {}),
      ...(opts.allowedTools?.length ? { allowedTools: opts.allowedTools } : {}),
      disallowedTools: opts.disallowedTools ?? DEFAULT_DISALLOWED_TOOLS,
      ...(skipPermissions
        ? { skipPermissions: true }
        : { unattendedPermissionPolicy: 'deny' as const }),
    },
  });

  const text = result.summary?.trim() ?? '';
  if (result.status !== 'completed' || !text) {
    throw new Error(
      `[${opts.label}] ${providerType} one-shot ${result.status}: ${result.errorMessage ?? 'no output'}`,
    );
  }
  return { text, providerType, model, raw: result };
}

export interface HarnessJsonOpts<T> extends HarnessOneShotOpts {
  schema: z.ZodType<T>;
  /**
   * Hand-written JSON shape shown to the model. Kept next to the zod schema
   * at the call site so the two evolve together (CLI harnesses have no
   * native structured-output channel to bind the schema to).
   */
  shape: string;
}

/**
 * Pull the first JSON object out of model text: tolerates markdown fences
 * and prose before/after the object. Throws when nothing parses.
 */
export function extractJsonObject(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in output');
  return JSON.parse(unfenced.slice(start, end + 1));
}

/**
 * One-shot with a structured JSON result: instructs JSON-only output,
 * parses + zod-validates, and retries once with the validation error
 * appended before giving up.
 */
export async function runHarnessJson<T>(opts: HarnessJsonOpts<T>): Promise<T> {
  const { schema, shape, ...callOpts } = opts;
  const basePrompt =
    `${opts.prompt}\n\n` +
    `Respond with ONLY a single JSON object (no markdown fences, no commentary) matching exactly this shape:\n${shape}`;

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nYour previous reply was rejected (${lastError}). Reply again with ONLY the JSON object.`;
    const { text } = await runHarnessText({ ...callOpts, prompt });
    try {
      return schema.parse(extractJsonObject(text));
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 500) : String(err);
    }
  }
  throw new Error(`[${opts.label}] structured output failed after 2 attempts: ${lastError}`);
}
