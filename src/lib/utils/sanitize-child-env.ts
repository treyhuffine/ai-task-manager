/**
 * Sanitize the environment for processes Flow spawns on behalf of the
 * user — preview dev servers, agent terminals, anything downstream of
 * Flow's own Node process.
 *
 * Why this matters: Flow runs as a Next.js worker process. Next exports
 * a pile of private variables into its workers (`TURBOPACK=1`,
 * `__NEXT_PRIVATE_ORIGIN`, `__NEXT_PROCESSED_ENV`, `NEXT_PRIVATE_WORKER`,
 * `NEXT_RUNTIME=nodejs`, `PORT=4224`, …). Any child that inherits the
 * whole `process.env` from us inherits those too. The damage:
 *
 *   - A child `next dev` sees `TURBOPACK=1` and force-enables Turbopack
 *     mid-build, refusing to start if the user's app uses Babel.
 *   - `PORT=4224` makes child dev servers try to bind to Flow's own port.
 *   - `__NEXT_PRIVATE_ORIGIN` / `NEXT_PRIVATE_WORKER` make a child Next
 *     think it's a worker of the parent Flow server, producing subtle
 *     wrong-origin / routing bugs.
 *
 * Strategy: start from the full env (so PATH, HOME, locale, language
 * toolchains all flow through), then drop the names that should never
 * cross the process boundary. Returning `NodeJS.ProcessEnv` (not a
 * plain Record) preserves Next's typed-env discriminators (NODE_ENV
 * etc.) so `spawn`/`pty.spawn` overload resolution stays happy.
 */

const STATIC_DROP = new Set<string>([
  // Flow's own run mode must not cross into the user's app processes. If Flow
  // runs as a production server (NODE_ENV=production), a child `yarn install`
  // would SKIP devDependencies (breaking dev servers that need them, e.g. a
  // next.config that requires a dev-only module), and `next dev` would warn /
  // misbehave on a non-standard value. Dropped → each tool defaults its own
  // (`next dev`→development, `next build`→production, installs→full).
  'NODE_ENV',

  // Network / binding — would force the child onto Flow's port.
  'PORT',
  'HOST',

  // Next.js internal worker plumbing — leaks Flow's identity into a
  // child Next dev server.
  'TURBOPACK',
  'NEXT_RUNTIME',
  'NEXT_PRIVATE_WORKER',
  'NEXT_PRIVATE_TRACE_ID',
  'NEXT_DEPLOYMENT_ID',
  '__NEXT_PRIVATE_ORIGIN',
  '__NEXT_PROCESSED_ENV',

  // Portless inheritance — if Flow itself was started under
  // `portless run`, these point at Flow's allocation, not the child's.
  'PORTLESS_URL',
  'PORTLESS_TAILSCALE_URL',
  'PORTLESS_APP_PORT',
  'NODE_EXTRA_CA_CERTS',
]);

/**
 * Prefixes whose entire namespace is stripped. `__NEXT_*` and
 * `NEXT_PRIVATE_*` cover any current/future Next worker plumbing
 * without enumerating every variable name.
 */
const DROP_PREFIXES = ['__NEXT_', 'NEXT_PRIVATE_', 'FLOW_'];

export function sanitizeChildEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(out)) {
    if (STATIC_DROP.has(k)) {
      out[k] = undefined;
      continue;
    }
    for (const prefix of DROP_PREFIXES) {
      if (k.startsWith(prefix)) {
        out[k] = undefined;
        break;
      }
    }
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      out[k] = v;
    }
  }
  return out;
}
