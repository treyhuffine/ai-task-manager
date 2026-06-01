/**
 * Preview names are DNS labels.
 *
 * A preview is reached at `https://<name>.<base>` (beamd, flat edge) or
 * `https://<name>.<slug>.<base>` (namespaced) — and beamd's wildcard cert
 * is exactly **one DNS label deep**. So `<name>` must be a single RFC-1123
 * label: lowercase `[a-z0-9-]`, no leading/trailing hyphen, ≤63 chars.
 * Portless's `<name>.localhost` has the same shape requirement.
 *
 * The worktree directory leaf is already `<workspace-slug>-<6hex>` (see
 * `buildWorktreeLeaf` in `src/lib/workspaces`), which is DNS-safe by
 * construction. This helper is the single chokepoint that guarantees the
 * label is valid even for hand-edited or legacy inputs, and appends a
 * service suffix with hyphens (never dots — dots would nest labels and
 * fall outside the one-label cert).
 */

/** Max length of a single DNS label (RFC 1035 §2.3.4). */
export const MAX_LABEL_LENGTH = 63;

/**
 * Build the preview name (a single DNS label) for a worktree, optionally
 * scoped to a service.
 *
 *   previewName('flow-a3f9')        === 'flow-a3f9'
 *   previewName('flow-a3f9', 'api') === 'flow-a3f9-api'
 *   previewName('Flow_A3F9', 'Web') === 'flow-a3f9-web'
 *
 * Any character outside `[a-z0-9-]` becomes a hyphen; runs of hyphens
 * collapse; leading/trailing hyphens are trimmed; the result is lowercased
 * and clamped to 63 chars (re-trimming a trailing hyphen the clamp might
 * expose). Falls back to `app` if the input sanitizes to nothing.
 */
export function previewName(worktreeName: string, service?: string | null): string {
  const base = sanitizeLabelPart(worktreeName);
  const svc = service ? sanitizeLabelPart(service) : '';
  // Keep the worktree identity present even when it sanitizes to nothing —
  // `app-api` beats a bare `api` that two different worktrees could collide on.
  const joined = svc ? `${base || 'app'}-${svc}` : base;
  if (!joined) return 'app';
  return clampLabel(joined);
}

/**
 * Lowercase, replace every non-`[a-z0-9-]` rune with a hyphen, collapse
 * hyphen runs, and strip leading/trailing hyphens — i.e. the fully cleaned
 * single-label form of one part.
 */
function sanitizeLabelPart(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

/** Clamp to MAX_LABEL_LENGTH, re-trimming a trailing hyphen the cut exposes. */
function clampLabel(label: string): string {
  if (label.length <= MAX_LABEL_LENGTH) return label;
  return label.slice(0, MAX_LABEL_LENGTH).replace(/-+$/, '');
}

/**
 * Is `value` already a valid single RFC-1123 DNS label? Used to validate
 * user-supplied names (manual hostnames, service suffixes) before they
 * reach beamd, which would otherwise reject them at tunnel-open time.
 */
export function isValidPreviewLabel(value: string): boolean {
  if (value.length === 0 || value.length > MAX_LABEL_LENGTH) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value);
}
