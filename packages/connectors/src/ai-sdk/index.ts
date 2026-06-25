/**
 * AI-SDK projection (§11): turn connector actions into a Vercel AI SDK `ToolSet`
 * over the *same* `runAction` — so the agent path passes the identical gates as
 * app code. Three things the projection owns, none of them an authoring burden:
 *
 *   1. `account` injection — each tool's object schema gains an optional `account`
 *      (its description enumerates the live accounts); the runtime strips it
 *      before `execute`, so action schemas stay pure (§6).
 *   2. Structured outcomes are preserved as model-facing results, but the raw
 *      `authorizationUrl` and opaque `connectionId` are NOT shown to the model —
 *      the model sees labels/emails and a plain instruction; the host receives
 *      the full outcome (URL + ids) out-of-band via `onPause` (§8/§11).
 *   3. Tool names are sanitized (`gmail.send_email` → `gmail__send_email`) to fit
 *      provider tool-name rules.
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { toToolName, projectedDescription, accountDisplay, modelSafeOutcome, type FailedOutcome } from '../core/projection-shared';
import type { ActionOutcome, Caller, ConnectorRuntime, Redactor, Toolkit } from '../core/types';

export interface ToToolSetOptions {
  ownerId?: string;
  /** Restrict to these toolkit ids; default all registered toolkits. */
  toolkits?: string[];
  caller?: Caller;
  /**
   * Host channel for pause/error outcomes. Receives the FULL outcome (with the
   * authorizationUrl + connectionId) so the host can drive the connect / account-
   * picker / approval UI. The model only ever sees the redacted summary.
   */
  onPause?: (actionId: string, outcome: ActionOutcome) => void;
  /**
   * The same `Redactor` wired into the runtime. When supplied, tool *results* are
   * scrubbed before they reach the model — closing the tool-I/O sink (§8/§17).
   */
  redactor?: Redactor;
  /**
   * Hard-pin a toolkit to one connection id, keyed by toolkit id. A pinned toolkit's tools run
   * against exactly that connection (no `account` choice exposed) — mirrors `serveMcp`.
   */
  connectionPins?: Record<string, string>;
}

export async function toToolSet(runtime: ConnectorRuntime, options: ToToolSetOptions = {}): Promise<ToolSet> {
  const ownerId = options.ownerId;
  const caller: Caller = options.caller ?? { type: 'agent' };
  const all = runtime.getToolkits();
  const selected: Toolkit[] = options.toolkits ? all.filter((t) => options.toolkits!.includes(t.id)) : all;

  // Enumerate live accounts per provider so the `account` description is concrete. Use the
  // disambiguated choices (email/label + auth-config tiebreaker) — the exact strings resolution
  // accepts back — so a duplicate email is distinguishable on the first try, not after a round-trip.
  const providerIds = [...new Set(selected.map((t) => t.providerId))];
  const accountsByProvider = new Map<string, string[]>();
  for (const providerId of providerIds) {
    const choices = await runtime.listAccountChoices(providerId, ownerId ? { ownerId } : {});
    accountsByProvider.set(providerId, choices.map(accountDisplay).filter((s): s is string => !!s));
  }

  const tools: ToolSet = {};
  for (const toolkit of selected) {
    const accounts = accountsByProvider.get(toolkit.providerId) ?? [];
    const accountDesc =
      accounts.length > 1
        ? `Which connected account to act as. One of: ${accounts.map((a) => `"${a}"`).join(', ')}. Omit only if the user clearly means a single account.`
        : 'Which connected account to act as (email or label). Usually omit — there is at most one connected account.';

    const pin = options.connectionPins?.[toolkit.id];
    for (const a of toolkit.actions) {
      const baseSchema = a.input as unknown as z.ZodObject<z.ZodRawShape>;
      const inputSchema = pin ? baseSchema : baseSchema.extend({ account: z.string().optional().describe(accountDesc) });

      tools[toToolName(a.id)] = tool({
        description: projectedDescription(a),
        inputSchema,
        execute: async (args: Record<string, unknown>) => {
          const { account, ...rest } = args as { account?: string } & Record<string, unknown>;
          const outcome = await runtime.runAction(a.id, rest, {
            ...(ownerId ? { ownerId } : {}),
            ...(pin ? { connectionId: pin } : account ? { account } : {}),
            caller,
          });
          if (outcome.ok) return options.redactor ? options.redactor.redact(outcome.result) : outcome.result;
          options.onPause?.(a.id, outcome);
          return modelSafeOutcome(outcome as FailedOutcome);
        },
      });
    }
  }
  return tools;
}
