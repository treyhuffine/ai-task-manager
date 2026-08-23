/**
 * Write-approval policy: which mutating connector actions run on the user's
 * standing intent (they connected the account) versus which pause for an
 * explicit, per-call human approval.
 *
 * The engine's `risk` score is "how bad if wrong," not "safe to run unattended,"
 * so it is a poor gate on its own — several outward sends sit at `low`/`medium`
 * (slack.post_message, telegram.send_message, resend.send_email, ...). We instead
 * split on two independent properties:
 *
 *   - OUTWARD: the action leaves the user's control (send / post / publish /
 *     share / upload a message, DM, email). Hard to unsend.
 *   - IRREVERSIBLE: `risk: 'high'` — every delete, cancel, and money-moving call.
 *
 * Either one defaults to ASK. Everything else mutating (drafts, labels, and the
 * reversible create/update/append of docs, sheets, events, tasks, tickets,
 * pages, records) defaults to AUTO, because connecting the account with write
 * scope is a clear signal the user wants those to just work.
 *
 * The default is only a default: a per-action override (persisted, surfaced at
 * connect time and in settings) can flip any action either way — turn on
 * `send_email` if you trust it, or pull a reversible write back behind the gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RiskLevel } from '@connectors/engine';
import { getConfigDir } from '@/lib/config/paths';

export type ApprovalMode = 'auto' | 'ask';

export interface ActionApprovalFacts {
  actionId: string;
  risk: RiskLevel;
  mutating: boolean;
}

/**
 * Outward = the action pushes content out to other people/systems, where an
 * unwanted call cannot be quietly taken back. Keyed off the method segment
 * (`provider.method`) rather than a per-action allowlist so new providers inherit
 * the safe default automatically.
 */
export function isOutwardAction(actionId: string): boolean {
  const method = actionId.includes('.') ? actionId.slice(actionId.indexOf('.') + 1) : actionId;
  // Leading verb (send_email, post_message, publish_page, upload_media, share_file, dm_user,
  // tweet, broadcast_*) or a trailing noun that is inherently a message (…_message, …_mail).
  return /^(send|post|publish|share|upload|dm|tweet|broadcast|reply)(_|$)/.test(method) || /(message|mail)$/.test(method);
}

/** The built-in default for an action, before any user override. */
export function defaultApprovalMode(facts: ActionApprovalFacts): ApprovalMode {
  if (!facts.mutating) return 'auto'; // reads are never gated
  if (facts.risk === 'high') return 'ask'; // deletes, cancels, send_email, money movement
  if (isOutwardAction(facts.actionId)) return 'ask'; // outward sends underscored as low/medium
  return 'auto'; // reversible, internal writes
}

// ── Persisted per-action overrides ───────────────────────────────────────────

interface WritePolicyFile {
  overrides?: Record<string, ApprovalMode>;
}

function policyPath(): string {
  return path.join(getConfigDir(), 'connectors', 'write-policy.json');
}

let cache: { mtimeMs: number; data: WritePolicyFile } | null = null;

function read(): WritePolicyFile {
  try {
    const st = fs.statSync(policyPath());
    if (cache && cache.mtimeMs === st.mtimeMs) return cache.data;
    const data = JSON.parse(fs.readFileSync(policyPath(), 'utf8')) as WritePolicyFile;
    cache = { mtimeMs: st.mtimeMs, data: data && typeof data === 'object' ? data : {} };
    return cache.data;
  } catch {
    return {};
  }
}

function write(data: WritePolicyFile): void {
  const dir = path.join(getConfigDir(), 'connectors');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${policyPath()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, policyPath());
  try {
    fs.chmodSync(policyPath(), 0o600);
  } catch {
    /* best-effort */
  }
  cache = null;
}

/** The user's override for an action, if any. */
export function getActionOverride(actionId: string): ApprovalMode | undefined {
  return read().overrides?.[actionId];
}

/** Effective mode = override, else the built-in default. */
export function resolveApprovalMode(facts: ActionApprovalFacts): ApprovalMode {
  return getActionOverride(facts.actionId) ?? defaultApprovalMode(facts);
}

/** Set (or clear, with `null`) an action's override. Clearing restores the default. */
export function setActionOverride(actionId: string, mode: ApprovalMode | null): void {
  const overrides = { ...(read().overrides ?? {}) };
  if (mode === null) delete overrides[actionId];
  else overrides[actionId] = mode;
  write({ overrides });
}

/** All current overrides (for the settings UI). */
export function listOverrides(): Record<string, ApprovalMode> {
  return { ...(read().overrides ?? {}) };
}
