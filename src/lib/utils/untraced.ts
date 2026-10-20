/**
 * Returns its argument, so the build stops following it.
 *
 * Turbopack traces every path a server module could read or run, and a value
 * it can only partly work out (`process.env.X || 'claude'`) becomes a pattern
 * that matches every file in the project. Each route that imports the module
 * then traces the whole tree into its `.nft.json` (gigabytes across a build).
 * A `turbopackIgnore: true` comment on the first argument stops this for `fs`
 * calls, `path.join` and `path.resolve`, but not for `spawn`, and helpers in
 * the same module are followed. Turbopack doesn't follow values through
 * calls into other modules, so passing one through this function does.
 */
export function untraced<T>(value: T): T {
  return value;
}
