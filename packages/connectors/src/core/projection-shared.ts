/**
 * Projection helpers shared by the AI-SDK and MCP surfaces (§11). Kept in core
 * (no `ai` / MCP-SDK imports) so both projections stay consistent: same tool-name
 * sanitization, same model-safe redaction of pause/error outcomes — the model
 * never sees a raw `authorizationUrl` or an opaque `connectionId` (§8).
 */
import type { Action, ActionOutcome } from './types';

export type FailedOutcome = Extract<ActionOutcome, { ok: false }>;

/** Sanitize an action id (`gmail.send_email`) into a provider-safe tool name. */
export function toToolName(actionId: string): string {
  return actionId.replace(/[^a-zA-Z0-9_-]/g, '__');
}

/**
 * The model-facing description for an action — annotates deprecated actions in-band so the agent
 * prefers the replacement, while the tool stays callable (the action id is a public contract we
 * never silently drop). Used by both the AI-SDK and MCP projections so they read identically.
 */
export function projectedDescription(action: Pick<Action, 'description' | 'deprecated' | 'replacedBy'>): string {
  if (!action.deprecated) return action.description;
  const note = action.replacedBy ? `DEPRECATED — use \`${action.replacedBy}\` instead.` : 'DEPRECATED.';
  return `${note} ${action.description}`;
}

/**
 * The human/model-facing token for one account choice — `email`/`label`, disambiguated with the
 * minting config's label when present ("me@gmail.com (Work)"). This is the SINGLE canonical form
 * shown to the model AND accepted back by resolution (runtime `tokensFor`), so the same email via
 * two auth configs round-trips instead of looping on `needs_account`.
 */
export function accountDisplay(choice: { email?: string; label?: string; authConfigLabel?: string }): string | undefined {
  const base = choice.email ?? choice.label;
  if (!base) return undefined;
  return choice.authConfigLabel ? `${base} (${choice.authConfigLabel})` : base;
}

/** The model-facing view of a non-ok outcome — never URLs or ids. */
export function modelSafeOutcome(outcome: FailedOutcome): Record<string, unknown> {
  switch (outcome.reason) {
    case 'auth_required':
      return {
        status: 'authorization_required',
        provider: outcome.providerId,
        message: `This needs a connected ${outcome.providerId} account. The app is prompting the user to authorize — tell them to complete it, then retry.`,
      };
    case 'needs_account':
      return {
        status: 'choose_account',
        provider: outcome.providerId,
        // Carry the minting-config tiebreaker so the same email via two clients is distinguishable
        // (e.g. "me@gmail.com (Work)" vs "(Personal)") — §7. Still never the opaque connectionId.
        // These exact strings round-trip: resolution accepts them back (runtime `tokensFor`).
        accounts: outcome.choices.map(accountDisplay).filter(Boolean),
        message: 'Multiple accounts are connected. Ask the user which one, then retry with the `account` field set to that exact value.',
      };
    case 'needs_consent':
      return {
        status: 'additional_permission_required',
        provider: outcome.providerId,
        missingScopes: outcome.missingScopes,
        message: 'This account needs additional permission. The app is prompting the user to grant it — tell them to complete it, then retry.',
      };
    case 'auth_config_required':
      // Reserved/dormant (multi-client). Mirror needs_account: the model sees connection-method
      // LABELS only — never the opaque authConfigId, which the host gets out-of-band via onPause.
      return {
        status: 'choose_connection_method',
        provider: outcome.providerId,
        options: outcome.choices.map((c) => c.label).filter(Boolean),
        message: 'This provider has more than one connection method. Ask the user which to use; the app will then start the connect flow.',
      };
    case 'approval_required':
      return {
        status: 'approval_required',
        message: 'This action needs the user’s approval. The app is asking them now — retry once they approve.',
      };
    case 'error':
      return {
        status: 'error',
        code: outcome.code,
        message: outcome.message,
        ...(outcome.indeterminate ? { indeterminate: true } : {}),
      };
  }
}
