/**
 * One value per Node process, shared by every copy of the module that asks.
 *
 * The server loads its own code more than once in one process: Next compiles
 * startup (instrumentation, the WebSocket host), route handlers and the proxy
 * as separate bundles, and the service's HTTP host is another. Each copy of a
 * module gets its own module-level variables, so a Map of work in flight, a
 * provider registered at startup or a database connection would silently
 * exist once per bundle. State that must agree across them lives here
 * instead, on globalThis under a registered symbol.
 *
 * A module-level cache whose copies can safely disagree (each just recomputes)
 * can stay a plain variable. `process-state.test.ts` keeps the list of those
 * honest.
 */
export function processState<T>(name: string, init: () => T): T {
  const slots = globalThis as unknown as Record<symbol, T | undefined>;
  const key = Symbol.for(`finance.process.${name}`);
  return (slots[key] ??= init());
}
