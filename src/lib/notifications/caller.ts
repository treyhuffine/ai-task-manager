/**
 * The notifier's trusted-dispatch identity + delivery allowlist (spec §2.3/§2.17). Kept in a
 * dependency-free leaf so BOTH the notifier adapters AND the connectors approval policy can import
 * it without a cycle (approval → here ← adapters). The bypass is NARROW: the host approval policy
 * auto-allows ONLY this caller, and ONLY for these allowlisted delivery actions — agent/MCP calls
 * stay fully gated.
 */
import type { Caller } from '@connectors/engine';

export const NOTIFIER_CALLER: Caller = { type: 'app', id: 'notifier' };

/** Connector actions the notifier is allowed to invoke unprompted (templated, app-driven sends). */
export const NOTIFIER_DELIVERY_ACTIONS = new Set<string>(['telegram.send_message']);

/** Is this approval check a notifier delivery that the narrow bypass should auto-allow? */
export function isNotifierDelivery(caller: Caller | undefined, actionId: string): boolean {
  return caller?.type === NOTIFIER_CALLER.type && caller.id === NOTIFIER_CALLER.id && NOTIFIER_DELIVERY_ACTIONS.has(actionId);
}
