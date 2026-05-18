# Slash Menu: Agent-Invocable Skills Surface

Self-contained plan for adding a `/`-triggered popup to the chat
composer that lists agent skills the user can explicitly invoke.
Same UX as Claude Code's terminal: type `/`, see a filtered list,
pick with arrows + Enter, the selected skill expands into the
message (or runs directly).

This is **not** a port of Claude Code's CLI commands (`/clear`,
`/model`, `/help` — utilities for managing the CLI itself). Those
don't belong in a chat composer. The menu surfaces **agent
capabilities** — things the AI can do, made discoverable as a
typed inline picker. Think `/summarize`, `/plan`, `/research`,
`/web-search`, or any user-authored skill workflow.

Builds on the existing Tiptap composer (`ChatInputEditor` at
`src/components/chat/editor/chat-input-editor.tsx`) and the
notes/tasks `@tiptap/suggestion` integration at
`src/components/editor/slash-commands.tsx` — the renderer in that
file is lifted nearly verbatim. The orchestrator action registry
at `src/lib/orchestrator/registry.ts` becomes one of several
sources (deferred from v1).

## The conceptual model

Two layers, kept distinct:

1. **What goes in the menu.** A `SlashCommand` — name, description,
   source label, optional arguments, and one of two execution
   modes: `local` (handler function) or `prompt` (markdown body
   that expands into the user message). Every entry, regardless
   of where it came from, conforms to this single shape.

2. **Where entries come from.** A `SlashCommandProvider` returns
   `SlashCommand[]`. v1 ships exactly one provider — the static
   `BuiltinProvider`. The architecture explicitly anticipates
   three more (`DiskSkillsProvider`, `OrchestratorProvider`,
   `MCPProvider`) so each can be added as a single new file
   without touching the editor, popup, or filter pipeline. Each
   added later, when there's a reason to.

The reason for the provider abstraction is that the *sources*
have different lifecycles (static vs. filesystem-watched vs.
registry-derived vs. MCP-protocol), but the *consumer* (the
popup) only needs `SlashCommand[]`. Forcing the static array
into a provider on day one keeps the seam small and obvious.

## Goals

1. Typing `/` at the start of the chat composer opens a popup
   listing all visible skills, filterable by typing.
2. Mid-input `/<word>` highlights known skill names inline (no
   popup) and offers Tab-to-complete via ghost text. Matches
   Claude Code's actual UX — the popup is start-of-input only,
   but mid-text recognition still happens.
3. Skills can be plain handlers (`/clear-context`), prompt
   templates with arguments (`/plan <goal>`), or markdown bodies
   loaded from disk (later).
4. Some skills auto-submit on Enter (`autoSubmit: true`); most
   leave the cursor in the composer for argument typing.
5. One implementation in `ChatInputEditor`, opted into per
   surface. Executor first; dashboard and slideout opt in
   trivially later.
6. Adding a new provider is a single new file plus a one-line
   registration. No editor changes.
7. No new heavyweight dependencies. `@tiptap/suggestion` is
   already installed; `fuse.js` adds ~12 KB gzipped.

Explicit non-goals:

- Not reproducing `/clear`, `/help`, `/model` from Claude Code.
  Those manage a CLI session; this is a chat composer.
- Not building a skill *authoring* UI in v1. Markdown skills
  arrive as a follow-up when there's content to load.
- Not surfacing every orchestrator action by default. They
  become available *through* a provider, but the provider can
  filter to a curated subset.
- Not implementing usage-based recency in v1. Hardcoded sort
  by source + alphabetical. Recency is a clean follow-up.
- Not handling forked sub-agent execution (`context: 'fork'`
  in Claude Code OS). Defer.

## Architecture

```
ChatInputEditor (Tiptap)
   │
   ├─ SlashMenuExtension (start-of-input '/' → popup)
   ├─ InlineHighlightExtension (mid-input '/<known>' → highlight)
   │
   └─ slashCommands: SlashCommand[]   ← prop, opt-in per surface
                  ▲
                  │
        useSlashCommands() hook (TanStack Query)
                  ▲
                  │
            Aggregator: merge + uniqBy(name)
                  ▲
        ┌─────────┼──────────────┐
        │         │              │
   BuiltinProv  (DiskSkills)  (Orchestrator)   ← v2+
                              (MCP)
```

The popup component, the renderer (DOM mounting), the filter
pipeline, and the keymap have **zero awareness of where commands
came from**. They consume `SlashCommand[]` and emit selection
events. That's the invariant that makes adding sources cheap.

## The `SlashCommand` type

```ts
export type SlashCommandSource =
  | 'builtin' | 'skill' | 'orchestrator' | 'mcp' | 'plugin'

export interface SlashCommand {
  name: string                              // 'plan' — the slash key
  description: string                       // shown in the menu row
  source: SlashCommandSource
  sourceLabel?: string                      // 'bundled' | 'user' | 'project' | plugin name

  argumentHint?: string                     // '<goal>' ghost text
  argumentNames?: string[]                  // ['title','description']

  userInvocable: boolean                    // false → hidden from menu (model-only)
  autoSubmit: boolean                       // true → Enter submits immediately

  // Exactly one of these is set:
  type: 'local' | 'prompt'
  handler?: (args: string, ctx: SlashCtx) => Promise<SlashResult>
  body?: string                             // markdown with $args / $named substitution
}

export interface SlashCtx {
  workspaceId?: string
  executionId?: string
  surface: 'executor' | 'dashboard' | 'slideout'
  /* TanStack queryClient, toast handle, navigation helpers, etc. */
}

export type SlashResult =
  | { kind: 'text'; message: string }       // append a system message
  | { kind: 'submit'; text: string }        // submit as user message
  | { kind: 'skip' }                        // ran for side effect only
  | { kind: 'error'; message: string }
```

The discriminator `type` distinguishes the two execution paths.
`local` is the "I just want to call code" path — useful for
direct tool invocations. `prompt` is the "stamp a workflow" path
— useful for predefined prompts the agent runs.

## Provider interface

```ts
export interface SlashCommandProvider {
  name: string                              // 'builtin' | 'disk' | …
  load(ctx: ProviderCtx): Promise<SlashCommand[]>
}

export interface ProviderCtx {
  workspaceId?: string
  cwd?: string                              // for filesystem walks
}
```

Aggregation in `src/lib/slash-commands/aggregator.ts`:

```ts
export async function loadAllSlashCommands(ctx: ProviderCtx) {
  const providers = getRegisteredProviders()
  const lists = await Promise.all(providers.map(p => p.load(ctx)))
  return uniqBy(lists.flat(), 'name')        // first wins → override order
}
```

The exposed React hook wraps this in TanStack Query:

```ts
export function useSlashCommands(ctx: ProviderCtx) {
  return useQuery({
    queryKey: ['slash-commands', ctx.workspaceId],
    queryFn: () => loadAllSlashCommands(ctx),
    staleTime: 60_000,
  })
}
```

v1 registers exactly one provider — `BuiltinProvider` wrapping
the static array. The other three are stubs in the codebase that
return `[]` until implemented. That preserves the seam.

## Trigger semantics

Two distinct triggers, both reading the same registry:

**Popup trigger.** `@tiptap/suggestion` configured with
`char: '/', startOfLine: true, allowSpaces: false`. Fires on `/`
**only when it's the first character of the composer's first
block**. This matches Claude Code's `isCommandInput(input) =
input.startsWith('/')`. The popup is anchored to the caret and
filters as the user types after the slash.

**Inline highlight.** A separate ProseMirror decoration plugin
scans paragraph text for `/<known-command-name>` patterns
anywhere — not just at the start. When found, the slash and name
are wrapped in a `<span>` with a `slash-token` class. Tab while
the caret is inside (or immediately after) the match completes
the token. Enter submits normally. No popup is opened mid-input.

Both code paths read from the same `useSlashCommands()` result.
The decoration plugin maintains a `Map<string, SlashCommand>` for
O(1) name lookups.

Rationale for splitting them: a popup mid-prose is disruptive
(user is writing a sentence that happens to contain a slash);
recognition without a popup is useful (acknowledges the command,
allows quick autocomplete). Claude Code makes the same call.

## Filtering and ranking

Pure function in `src/lib/slash-commands/filter.ts`, lifted from
Claude Code OS's `commandSuggestions.ts:292-498` with the
CLI-specific bits stripped:

```ts
export function filterSlashCommands(
  query: string,
  commands: SlashCommand[]
): SlashCommand[] {
  const visible = commands.filter(c => c.userInvocable !== false)
  if (!query) return bucketBySource(visible)              // empty: bucket alphabetical
  return rankByPriority(query, fuseSearch(visible, query)) // typed: fuzzy + re-rank
}
```

**Empty query:** group by `source` (`builtin`, `skill`,
`orchestrator`, `mcp`, `plugin`) in that order, alphabetical
within each. Recency-based reordering deferred to v2.

**Non-empty query:** Fuse.js with weighted keys —
`{ name: 3, parts: 2, description: 0.5 }`, threshold 0.3.
Then a 5-tier re-rank:
1. Exact name match
2. Exact alias match (when we add aliases)
3. Name-prefix match
4. Alias-prefix match
5. Fuzzy score

The Fuse index is memoized on the commands-array identity.
Rebuilds only when the provider list changes (cache-busted by
TanStack Query invalidation), not on every keystroke.

## UX details

**Selection actions.** Modeled after Claude Code's
`applyCommandSuggestion`:

| Key | Effect |
|---|---|
| `↑` / `↓` | Move selection (clamped, no cyclic wrap) |
| `Tab` | Insert `/<name> ` into composer. Never submits. |
| `Enter`, no args | If `autoSubmit: true`, submit immediately. Otherwise insert `/<name> ` and leave caret. |
| `Enter`, has args | Insert `/<name> ` and leave caret (user types args). |
| `Esc` | Dismiss popup, don't insert. |

**Argument hints.** When `argumentHint` is set (e.g.
`<goal>`), render it as dim ghost text after the inserted name.
When `argumentNames: ['title','description']` is set, render
`[title] [description]` as ghost text and decrement as the
user fills each. Lifted from Claude Code OS's
`generateProgressiveArgumentHint`.

**Popup layout.** Up to 8 rows visible at a time, windowed
around the selected entry (matches Claude Code's
`OVERLAY_MAX_ITEMS = 5` shape, scaled up for a web layout).
Each row: icon (Lucide), name (mono), description (dimmed),
source badge (`bundled`/`user`/`project`/`plugin`).
Hover and keyboard selection use the same active state.

**Positioning.** Floating panel anchored to the caret, attached
above the composer on small viewports and below on large
(matches Tiptap notes-editor convention). The renderer at
`src/components/editor/slash-commands.tsx:261-352` handles
Radix Dialog ancestor transforms correctly — we lift it
nearly verbatim.

## Provider designs

### BuiltinProvider (v1 — ships day one)

Static array in `src/lib/slash-commands/builtins.ts`. The set
to ship is an open decision (see below) — small, agent-skill
focused, not CLI-utility focused.

```ts
export const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: 'plan',
    description: 'Generate a step-by-step plan for a goal',
    source: 'builtin',
    type: 'prompt',
    argumentHint: '<goal>',
    body: 'Generate a detailed plan to: $ARGUMENTS\n\nBreak it into …',
    userInvocable: true,
    autoSubmit: false,
  },
  // …
]
```

### DiskSkillsProvider (deferred)

Scans `<brain>/skills/<name>/SKILL.md` (and walks ancestors for
project-scoped skills, like Claude Code's
`getProjectDirsUpToHome`). Parses YAML frontmatter into the
`SlashCommand` shape using a port of Claude Code's
`frontmatterParser.ts`. Body markdown becomes `command.body`,
expanded via a port of `argumentSubstitution.ts`.

Adds:
- `src/lib/config/paths.ts` helper: `getSkillsDir()`.
- `src/app/api/slash-commands/route.ts` — server-side dir scan
  (client can't read disk).
- `src/lib/slash-commands/parse-frontmatter.ts` — lifted.
- `src/lib/slash-commands/providers/disk.ts` — the provider.

Skill frontmatter schema is a strict subset of Claude Code's
(no `hooks`, `paths`, `!shell` blocks — those are CLI-only
features that don't translate cleanly to a browser context).

### OrchestratorProvider (deferred)

Projects each entry in `src/lib/orchestrator/registry.ts`
`actions` into a `SlashCommand`. Each becomes `type: 'local'`
with a handler that invokes the action through the existing
dispatch path. Filter to a curated subset (read-only or
explicitly-safe mutators), not the full action list.

### MCPProvider (later)

Surfaces MCP-server-defined "prompts" (not tools — those are
model-only). Reads from the MCP client when Flow has MCP
support widely deployed.

## File layout

```
src/lib/slash-commands/
  types.ts                       (~60 lines)
  builtins.ts                    (~150)  ← v1 static set
  filter.ts                      (~120)  ← Fuse + 5-tier rank
  substitute.ts                  (~40)   ← $args / $named expansion
  aggregator.ts                  (~60)   ← provider merge + uniqBy
  use-slash-commands.ts          (~20)   ← TanStack Query hook
  providers/
    builtin.ts                   (~20)   ← BuiltinProvider
    disk.ts                      (stub for v1)
    orchestrator.ts              (stub)
    mcp.ts                       (stub)

src/components/chat/editor/slash-menu/
  extension.ts                   (~120)  ← Tiptap Suggestion wrapper
  inline-highlight.ts            (~80)   ← decoration plugin
  popup.tsx                      (~180)  ← React popup
  renderer.ts                    (~90)   ← lifted from notes editor
  index.ts                       (~10)   ← barrel

src/components/chat/editor/chat-input-editor.tsx
  ← +15 lines: optional slashCommands prop, conditional ext registration

src/components/executions/execution-composer.tsx
  ← +20 lines: useSlashCommands + dispatch handler

docs/slash-menu-spec.md           ← this file
```

Approximate total for v1: **~1,000 net new lines**, 10 new files,
3 edited files, 1 added dep (`fuse.js`).

## Integration: executor first

The executor (`src/components/executions/execution-composer.tsx`)
is where the slash menu lands first. Wiring:

```tsx
const { data: slashCommands = [] } = useSlashCommands({ workspaceId })

const handleSlashCommand = async (cmd: SlashCommand, args: string) => {
  if (cmd.type === 'local' && cmd.handler) {
    const result = await cmd.handler(args, { workspaceId, executionId, surface: 'executor' })
    dispatchSlashResult(result)
  } else if (cmd.type === 'prompt' && cmd.body) {
    const expanded = substituteArgs(cmd.body, args)
    onSubmit({ text: expanded, attachments: [] })
  }
}

<ChatInputEditor
  ref={editorRef}
  onSubmit={onSubmit}
  slashCommands={slashCommands}
  onSlashCommand={handleSlashCommand}
/>
```

Dashboard (`src/components/dashboard/content-panel.tsx`) and
slideout (`src/components/ai-elements/slideout-chat.tsx`) opt
in identically when ready. The `ChatInputEditor` change is a
single conditional block that registers the slash extensions
only if `slashCommands` is passed.

## Open decisions

1. **The v1 builtin command set.** Candidates that fit the
   agent-skill framing:

   | Name | Type | Notes |
   |---|---|---|
   | `/plan` | prompt | Generate step-by-step plan from a goal |
   | `/summarize` | prompt | Summarize current chat or workspace context |
   | `/research` | prompt | Deep research mode with web fetching |
   | `/brainstorm` | prompt | Open-ended ideation |
   | `/critique` | prompt | Code/plan review pass |
   | `/web-search` | local | Direct tool invocation |
   | `/task` | local | Create a task tied to the current workspace |
   | `/note` | local | Create a note from current context |

   None of these are "the right answer" — they're an opening
   menu. The first 2–3 ship in v1, the rest land as we learn.

2. **`startOfLine` strictness for the popup trigger.** Claude
   Code requires the *entire input* to start with `/` to open
   the popup. For Tiptap, the closest equivalent is "first
   character of the first text node in the first block."
   Should we relax that to "any line in the composer" to allow
   multi-line chat composition that ends with a slash command?
   v1 ships strict.

3. **Hide `userInvocable: false` skills.** Yes, by default. They
   exist for completeness (so the model can call skills the user
   shouldn't see in the menu, e.g. internal-only tooling). The
   filter pipeline already gates on this.

4. **Inline highlight color.** Use the same accent as the
   `[[file:…]]` chip border so the visual language stays
   consistent. Decided at implementation time.

5. **Argument parsing for `local` handlers.** Pass args as a
   raw trailing string, not pre-split. Each handler decides its
   own parse rules. Matches Claude Code's pattern.

## Future

- **Recency ranking.** Add a `slash_command_usage` table (name,
  last_used_at, usage_count). Apply Claude Code's 7-day
  half-life decay (`skillUsageTracking.ts:44`) at empty-query
  time. ~80 lines, no schema migration drama.
- **Disk skills authoring UI.** A `/skill new` flow that writes
  a new `SKILL.md` into `<brain>/skills/<name>/`. Pairs with
  the disk provider arriving.
- **Per-workspace overrides.** Project-scoped skills shadowing
  user-scoped skills, mirroring Claude Code's ancestor walk.
  Falls out of the disk provider when it ships.
- **Markdown preview on hover.** Hovering a skill row reveals
  the prompt body or handler description in a side panel.
  Optional polish.
- **Inline argument capture.** Once a command needing args is
  inserted, surface the named-arg slots as discrete tokens
  the user fills via Tab-cycling between them. Closer to a
  form-builder UX than free-text args.
- **Slideout + dashboard opt-in.** Same prop pattern. Decide
  per-surface what command set is appropriate (the dashboard
  chat may want a different set than the executor).
