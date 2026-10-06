/**
 * Projection helpers shared by the AI-SDK and MCP surfaces (§11). Kept in core
 * (no `ai` / MCP-SDK imports) so both projections stay consistent: same tool-name
 * sanitization, same model-safe redaction of pause/error outcomes — the model
 * never sees a raw `authorizationUrl` or an opaque `connectionId` (§8).
 */
import type { AccountChoice, Action, ActionOutcome, RunActionOptions } from './types';

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

/**
 * How a projection binds one toolkit to accounts, from the host's `connectionPins` /
 * `allowedAccounts` options (a workspace's account scoping):
 *  - `open`: no constraint, the model may name any connected account
 *  - `pin`: exactly one connection, the `account` param is hidden and ignored
 *  - `allowed`: a set of 2+ connections, the model chooses, and `runAction` rejects anything outside
 *  - `blocked`: an empty set, the toolkit is not exposed at all (fail closed)
 * A pin wins over a set for the same toolkit, and a one-account set collapses to a pin.
 */
export type AccountBinding =
  | { kind: 'open' }
  | { kind: 'pin'; connectionId: string }
  | { kind: 'allowed'; choices: AccountChoice[] }
  | { kind: 'blocked' };

export function accountBinding(
  toolkitId: string,
  options: { connectionPins?: Record<string, string>; allowedAccounts?: Record<string, AccountChoice[]> },
): AccountBinding {
  const pin = options.connectionPins?.[toolkitId];
  if (pin) return { kind: 'pin', connectionId: pin };
  const allowed = options.allowedAccounts?.[toolkitId];
  if (!allowed) return { kind: 'open' };
  if (allowed.length === 0) return { kind: 'blocked' };
  if (allowed.length === 1) return { kind: 'pin', connectionId: (allowed[0] as AccountChoice).connectionId };
  return { kind: 'allowed', choices: allowed };
}

/** The `account` param description for an allowed set: names exactly the accounts the model may use. */
export function allowedAccountDescription(choices: AccountChoice[]): string {
  const names = choices.map(accountDisplay).filter((s): s is string => !!s);
  return (
    `Which account to act as. Only these accounts are allowed here: ${names.map((n) => `"${n}"`).join(', ')}. ` +
    'Pass one of these exact values. Omitting it returns a choose_account prompt.'
  );
}

/** The `runAction` options a binding contributes, given the model's `account` hint. */
export function bindingRunOptions(
  binding: AccountBinding,
  account: string | undefined,
): Pick<RunActionOptions, 'connectionId' | 'account' | 'allowedConnectionIds'> {
  switch (binding.kind) {
    case 'pin':
      return { connectionId: binding.connectionId };
    case 'allowed':
      return { allowedConnectionIds: binding.choices.map((c) => c.connectionId), ...(account ? { account } : {}) };
    case 'blocked':
      return { allowedConnectionIds: [] };
    case 'open':
      return account ? { account } : {};
  }
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
