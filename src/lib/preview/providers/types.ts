/**
 * The seam the whole preview system hangs off. A `PreviewProvider` turns a
 * running (or about-to-run) worktree dev server into a **reachable URL** —
 * localhost on the same machine, an HTTPS tunnel from anywhere, a route
 * Portless already owns, or a URL the user pasted in.
 *
 * Two flavors:
 *   - **dynamic** — has to start/stop something to produce the URL (beamd
 *     opens a tunnel). `resolve()` returns a `stop` to tear it down.
 *   - **static** — the URL already exists once the server is up (localhost,
 *     portless, manual). No teardown beyond stopping the server itself.
 *
 * Community plugins implement this interface and call
 * `registerPreviewProvider(provider)` — see `docs/preview-providers.md`.
 */

export interface PreviewTarget {
  /** A reachable URL for the app (no trailing path assumptions). */
  url: string;
  /** Tear down anything `resolve()` brought up (e.g. close the tunnel).
   *  Omitted by static providers. Must be idempotent. */
  stop?: () => Promise<void>;
}

export interface PreviewContext {
  /** Absolute path to the worktree dir the dev server runs in. Providers that
   *  shell a tool (e.g. beamd) run it with this `cwd` so project-local config
   *  — beamd's `beamd.yaml` (edge + scope) — is resolved from the right place. */
  cwd: string;
  /** The worktree directory leaf, e.g. `flow-a3f9`. */
  worktreeName: string;
  /** Named service in a multi-service worktree (`web` | `api`), or null. */
  service?: string | null;
  /** The local port the app is listening on (already confirmed up for
   *  providers that manage the server). */
  port: number;
  workspaceId: string;
  executionId: string;
  /** Precomputed single DNS label (`<worktree>[-<service>]`) — what a
   *  tunnel/route should be named. See `src/lib/preview/preview-name`. */
  previewName: string;
}

export type PreviewProviderKind = 'dynamic' | 'static';

export interface PreviewProvider {
  /** Stable id — the public contract. `localhost | beamd | portless | manual | <plugin>`. */
  id: string;
  /** Human label for the settings picker. */
  label: string;
  kind: PreviewProviderKind;
  /**
   * Does this provider need Flow to run + supervise the local dev server
   * before `resolve()` can produce a URL?
   *   - localhost / beamd → true (Flow owns the process)
   *   - portless (Portless owns the process) / manual (external) → false
   * Defaults to true when omitted.
   */
  managesLocalServer?: boolean;
  /** Return a reachable URL for this context, starting a tunnel if needed. */
  resolve(ctx: PreviewContext): Promise<PreviewTarget>;
  /**
   * Optional readiness check for the settings "active remote provider"
   * picker — e.g. beamd returns false until a server + token are set. A
   * provider with no requirements can omit this (treated as always ready).
   */
  isConfigured?(): boolean | Promise<boolean>;
}

/**
 * Thrown by a provider's `resolve()` to surface an actionable status to the
 * user (not logged in, agent down, tunnel cap hit, no port). The code is a
 * stable program-readable handle; the message is shown in the preview pane.
 */
export class PreviewProviderError extends Error {
  readonly code: string;
  /** Optional remediation hint shown under the message. */
  readonly hint?: string;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = 'PreviewProviderError';
    this.code = code;
    this.hint = hint;
  }
}
