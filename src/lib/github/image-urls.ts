/**
 * Images that live in a GitHub repository, in the forms GitHub documents and
 * agents write, the same lines that render inline on a pull request page:
 *
 *   https://github.com/<owner>/<repo>/blob/<ref>/<path>?raw=true
 *   https://github.com/<owner>/<repo>/blob/<ref>/<path>
 *   https://github.com/<owner>/<repo>/raw/<ref>/<path>
 *   https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
 *   https://raw.githubusercontent.com/<owner>/<repo>/refs/heads/<branch>/<path>
 *
 * A browser `<img>` to any of these carries no GitHub sign-in (cross-site,
 * SameSite cookies), so for a private repository GitHub answers 404 and the
 * card shows nothing. The home fetches the bytes instead, with the user's
 * own credential (`src/lib/github/repo-image.ts`), through the same
 * authenticated route that shows local images.
 *
 * Browser-safe: no Node imports. The transcript rewrite and the card use it.
 */

export const GITHUB_RAW_HOST = 'raw.githubusercontent.com';
const GITHUB_PAGE_HOSTS: ReadonlySet<string> = new Set(['github.com', 'www.github.com']);
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const REPO = /^[\w.-]+$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const IMAGE_NAME = /\.(?:png|jpe?g|gif|webp|avif|svg|heic|heif|bmp|ico)$/i;

export interface GithubImageSource {
  owner: string;
  repo: string;
  /** `<ref>/<path>` exactly as written. A branch name can contain slashes, so only GitHub can split it. */
  rest: string;
  /** Where the bytes come from, with the user's credential. Always on `raw.githubusercontent.com`. */
  fetchUrl: string;
  /** The file's page on github.com: what a signed-in browser can open when the preview cannot load. */
  pageUrl: string;
  /** The file name, for the card. */
  name: string;
  /** The ref is a full commit hash, so the bytes at this address never change. */
  immutable: boolean;
  /** The address serves the file's bytes (raw), not a page about it. */
  raw: boolean;
}

/** The repository image an address names, or null for anything else. */
export function githubImageSource(target: string): GithubImageSource | null {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.replace(/^\/+/, '').split('/');
  let rest: string[];
  let raw: boolean;
  if (host === GITHUB_RAW_HOST) {
    rest = segments.slice(2);
    raw = true;
  } else if (GITHUB_PAGE_HOSTS.has(host)) {
    const kind = segments[2];
    if (kind !== 'blob' && kind !== 'raw') return null;
    rest = segments.slice(3);
    const flag = url.searchParams.get('raw');
    raw = kind === 'raw' || flag === 'true' || flag === '1';
  } else {
    return null;
  }
  const [owner, repo] = segments;
  if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null;
  // A ref and at least one path segment, none of them empty or a dot segment.
  if (rest.length < 2 || rest.some(segment => !segment || segment === '.' || segment === '..')) return null;
  const name = decodeSegment(rest[rest.length - 1]!);
  const joined = rest.join('/');
  return {
    owner,
    repo,
    rest: joined,
    fetchUrl: `https://${GITHUB_RAW_HOST}/${owner}/${repo}/${joined}`,
    pageUrl: `https://github.com/${owner}/${repo}/blob/${joined}`,
    name,
    immutable: COMMIT.test(rest[0]!),
    raw,
  };
}

/**
 * A plain link that can only mean the image's bytes: a raw address with an
 * image name. A link to a `blob` page without `?raw=true` stays a link to
 * that page, which has more on it than the file.
 */
export function githubImageLink(target: string): GithubImageSource | null {
  const source = githubImageSource(target);
  return source && source.raw && IMAGE_NAME.test(source.name) ? source : null;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
