/**
 * Single source of truth for the app's permission-mode vocabulary.
 *
 * Leaf module by design: no React, no SDK, no schema imports. Both the Drizzle
 * schema (`chatSessions.permissionMode` / `prePlanMode`) and the client display
 * layer (`permission-modes.ts`) import this tuple, so it must not drag either
 * one's dependencies into the other's bundle.
 *
 * These names are APP-NATIVE and deliberately decoupled from any one harness's
 * flag vocabulary. Each harness adapter translates them to native flags in
 * `src/lib/executor/permission-map.ts`:
 *
 *   auto_all   - run every tool with no prompts
 *   auto_edits - auto-allow workspace edits, prompt for shell / network / other
 *   ask        - prompt before every mutating tool (reads run free)
 *   plan       - read-only: propose a plan, make no changes
 *
 * Declaration order is the Shift+Tab cycle order: most to least autonomous,
 * then it wraps.
 */
export const PERMISSION_MODES = ['auto_all', 'auto_edits', 'ask', 'plan'] as const;

/**
 * The policy default for a new session. Single source of truth for the value —
 * import this rather than repeating the literal. The `chat_sessions.permission_mode`
 * DB default is kept equal to this as an inert backstop (see docs/schema-defaults.md).
 */
export const DEFAULT_PERMISSION_MODE: (typeof PERMISSION_MODES)[number] = 'auto_all';
