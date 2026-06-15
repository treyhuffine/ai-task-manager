/**
 * Extract a GitHub pull-request reference from tool text. Deterministic:
 * `gh pr create` / `gh pr view` (and the GitHub MCP tools) emit the
 * canonical `https://github.com/<owner>/<repo>/pull/<N>` URL, whose shape
 * is stable. We surface it as a "PR #N ↗" link on the tool row.
 *
 * Matches PRs only (not issues). The trailing `(?!\d)` avoids gluing on
 * extra digits; `/files`, `/commits` suffixes are tolerated by stopping
 * the capture at the number.
 */

export interface PrRef {
  url: string;
  /** "owner/repo" */
  repo: string;
  number: number;
}

const PR_URL_RE = /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?!\d)/i;

export function extractPullRequestUrl(text: string | null | undefined): PrRef | null {
  if (!text) return null;
  const m = text.match(PR_URL_RE);
  if (!m) return null;
  // Normalize the URL to the bare PR permalink (drop any /files, ?query…).
  return { url: `https://github.com/${m[1]}/pull/${m[2]}`, repo: m[1], number: Number(m[2]) };
}
