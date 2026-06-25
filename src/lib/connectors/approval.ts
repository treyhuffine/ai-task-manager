/**
 * Host ApprovalPolicy for the connector engine — the real, grant-remembering gate that replaces
 * the dev auto-allow. The engine calls `check()` inside `runAction` (the single chokepoint);
 * this owns the policy:
 *
 *   - non-mutating actions run freely;
 *   - mutating actions need a grant keyed on (ownerId, actionId, connectionId, inputDigest,
 *     actionVersion) — the exact key the spec mandates, so the retry after a human approves
 *     matches (and a grant auto-invalidates when the input/schema/risk changes, because
 *     inputDigest/actionVersion change);
 *   - with no grant, a pending approval is registered (deduped by key) and `'ask'` is returned,
 *     which the runtime turns into an `approval_required` outcome.
 *
 * The human approves out-of-band (`resolvePendingApproval`, exposed via /api/connectors/approve);
 * the agent re-invokes the tool and the grant now matches → `'allow'`. In dev, `autoApprove`
 * bypasses the gate so the chat demos end-to-end; production runs the real gate.
 *
 * Grants/pendings are in-process (single-user, single-process host). A multi-instance host would
 * back these with a shared store — same interface.
 */
import { randomUUID } from 'node:crypto';
import type { ApprovalPolicy, ApprovalCheckInput } from '@connectors/engine';
import { isNotifierDelivery } from '@/lib/notifications/caller';

const GRANT_TTL_MS = 5 * 60_000;

export interface PendingApproval {
  id: string;
  ownerId: string;
  actionId: string;
  connectionId: string;
  risk: string;
  preview: unknown;
  createdAt: number;
}

interface InternalPending extends PendingApproval {
  key: string;
}

const pending = new Map<string, InternalPending>();
const grants = new Map<string, number>(); // grant key → expiry (ms epoch), single-use

function grantKey(i: ApprovalCheckInput): string {
  return [i.connection.ownerId, i.actionId, i.connection.id, i.inputDigest, i.actionVersion].join('|');
}

export interface AppApprovalOptions {
  /** Dev: auto-allow everything so the chat works end-to-end. Production: false → the real gate. */
  autoApprove?: boolean;
}

export function appApprovalPolicy(opts: AppApprovalOptions = {}): ApprovalPolicy {
  return {
    async check(input) {
      // NARROW trusted-dispatch bypass (spec §2.3): the app's own notifier sending a templated
      // delivery via an allowlisted action — never "all app callers". Agent/MCP calls fall through
      // to the real gate below. Must precede the mutating check (delivery actions are mutating).
      if (isNotifierDelivery(input.caller, input.actionId)) return 'allow';
      if (opts.autoApprove) return 'allow';
      if (!input.mutating) return 'allow';
      const key = grantKey(input);
      const exp = grants.get(key);
      if (exp && exp > Date.now()) {
        grants.delete(key); // single-use
        return 'allow';
      }
      // Register a pending approval for the human to resolve (dedupe by key).
      if (![...pending.values()].some((p) => p.key === key)) {
        const id = randomUUID();
        pending.set(id, {
          id,
          key,
          ownerId: input.connection.ownerId,
          actionId: input.actionId,
          connectionId: input.connection.id,
          risk: input.risk,
          preview: input.inputPreview,
          createdAt: Date.now(),
        });
        // Notifier (best-effort, transient §2.4): a new approval needs the human. Dynamic import
        // breaks the static approval→notify→connector-runtime→approval cycle; this is in-memory
        // state, so a lost notification on restart is consistent with the lost pending approval.
        void import('@/lib/notifications')
          .then(({ notify }) =>
            notify({
              type: 'connector.approval_required',
              userId: input.connection.ownerId,
              dedupeKey: `connector.approval_required:${id}`,
              title: 'Approval needed',
              body: `Approve "${input.actionId}"?`,
              url: '/connectors-test',
            }),
          )
          .catch(() => {});
      }
      return 'ask';
    },
  };
}

/** Pending approvals awaiting a human decision (UI / route consumes this). */
export function listPendingApprovals(ownerId?: string): PendingApproval[] {
  return [...pending.values()]
    .filter((p) => !ownerId || p.ownerId === ownerId)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ key, ...pub }) => pub);
}

/** Resolve a pending approval; `'allow'` records a single-use, short-TTL grant the retry matches. */
export function resolvePendingApproval(id: string, decision: 'allow' | 'deny'): boolean {
  const p = pending.get(id);
  if (!p) return false;
  pending.delete(id);
  if (decision === 'allow') grants.set(p.key, Date.now() + GRANT_TTL_MS);
  return true;
}
