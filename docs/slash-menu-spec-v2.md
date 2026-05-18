# Slash Menu — Spec v2

> Status: proposed
> Author: Trey (with Claude)
> Replaces: `slash-menu-spec.md` (compete-and-pick)

## 1. Why

Today the chat composer is a plain Tiptap editor. The user can type free-form
prompts and attach files, but every recurring intent — "triage my inbox",
"draft a status note from this week's stream", "summarize this task thread" —
has to be retyped. Each retype is friction, each variation is a small drift,
and the user ends up either (a) memorizing house prompts or (b) skipping the
structured prompt and getting worse output.

Slash commands fix that with the smallest possible mechanism: a file on disk
becomes a callable prompt, and the same file is callable by the agent. One
artifact, two surfaces.

**Design constraint, from CLAUDE.md:** *simple systems are ultimately the most
robust*. So:

- No proprietary command format. Markdown + YAML frontmatter — the same
  shape Claude Code, Cursor, and others already use. A user's existing
  `.claude/skills/` works here unchanged.
- No code-as-command in v1. The body of the skill IS the prompt. The agent
  surface stays the registry in `src/lib/orchestrator/registry.ts`; the
  slash menu is purely a *prompt expander*, not a parallel command runtime.
- No new storage system. Skills live under `brain/skills/` — same disk root
  as tasks/notes/areas. They are user content. They sync, they diff, they
  version with the rest of the brain.

The user has the open-source Claude Code reference at
`/Users/treyhuffine/code/claude-code-open-source/`. We are deliberately copying
the data model and discovery cascade from there so skills are *portable
between this app and the CLI*. That portability is the feature.

## 2. What it feels like

User types `/` at the start (or after whitespace) of the chat composer.
A floating popover opens, anchored to the caret. It shows a fuzzy-filtered
list of available skills:

```
┌─ Skills ────────────────────────────────────┐
│ /triage           Triage my inbox to today  │
│ /summarize        Summarize selected thread │
│ /plan             Draft a weekly plan       │
│ /braindump        Capture freeform thoughts │
│ /retro            Weekly retrospective      │
└─────────────────────────────────────────────┘
```

- **Up/Down** move the highlight. **Enter** selects. **Esc** dismisses.
- Continuing to type *narrows* the list with fuzzy match on name, aliases,
  and description. The visible `/` stays in the editor — the picker is a
  pure overlay on the natural Tiptap text.
- Selecting `/triage` *expands the skill body* as plain text into the
  editor at the caret. The user sees exactly what they're about to send,
  can tweak args inline, then hits Enter to submit normally.
- If the skill has an `argument-hint`, after expansion the caret lands at
  the `$ARGUMENTS` slot so the user can type the missing piece.
- **Shift-Enter on the picker** = expand AND immediately submit. For users
  who already trust the skill.

Only one trigger, one popover, one selection behavior. No modes.

## 3. Skill format

Each skill is a single `.md` file. YAML frontmatter declares metadata;
the body is the prompt template.

```markdown
---
name: triage
description: Triage my inbox to today's tasks
aliases: [tri, inbox]
argument-hint: <optional focus area>
when_to_use: When the user wants their unsorted braindumps assigned to today
model: claude-opus-4-7
---

You are helping me triage my inbox.

Focus area (optional): $ARGUMENTS

Walk through my unsorted braindumps and propose, for each:
1. Should this be a task, note, or discarded?
2. If task: which area, and is it today / this week / later?

Use the `query` MCP to read the inbox, then `update` to apply your
proposal once I confirm.
```

### 3.1 Frontmatter fields (v1)

| Field           | Type         | Required | Default            | Notes |
| --------------- | ------------ | -------- | ------------------ | ----- |
| `name`          | string       | yes      | (filename stem)    | Lowercase kebab-case. The thing typed after `/`. |
| `description`   | string       | yes      | —                  | One line. Renders in picker. |
| `aliases`       | string[]     | no       | `[]`               | Extra typeable names (`tri`, `inbox`). |
| `argument-hint` | string       | no       | —                  | Display hint, e.g. `<topic>`. |
| `when_to_use`   | string       | no       | —                  | Agent-side guidance. Not shown in picker. |
| `model`         | string       | no       | (chat default)     | Override chat model for this skill only. |
| `user-invocable`| boolean      | no       | `true`             | If `false`, skill is agent-only — hidden from picker. |
| `allowed-tools` | string[]     | no       | (all)              | Restrict orchestrator actions when this skill runs. |
| `paths`         | string[]     | no       | —                  | Glob patterns; only show this skill when current workspace/area matches. v2. |

We deliberately **adopt Claude Code's vocabulary** so a user can drop a file
from `~/.claude/skills/` straight into `brain/skills/` and it works. Fields
we don't support yet are parsed and ignored, not errors.

### 3.2 Body / argument substitution

Substitution rules, applied at expansion time:

- `$ARGUMENTS` → the entire string the user typed after the command on the
  trigger line. E.g. `/triage finance` → `$ARGUMENTS = "finance"`.
- `$1`, `$2`, ... → space-split positional args.
- `{{date}}` → today's ISO date.
- `{{workspace}}` → current workspace slug, if any.
- Anything else (`{{foo}}`) is left literal — never silently dropped.

If the body contains `$ARGUMENTS` and the user typed no args, the cursor
lands at that placeholder after expansion (token deleted) so the user can
type into it.

## 4. Storage & discovery

### 4.1 Disk layout

```
<app-root>/
├── brain/
│   ├── skills/             ← user-authored skills (per brain)
│   │   ├── triage.md
│   │   └── summarize.md
│   └── …
├── skills-bundled/         ← shipped with the app, read-only
│   ├── triage.md
│   └── …
~/.<app-short-id>/
└── skills/                 ← cross-brain user skills (optional)
    └── retro.md
```

- `brain/skills/` — primary. Lives next to tasks/notes/areas. Syncs with the
  brain. Resolved via a new `getSkillsDir()` in `src/lib/config/paths.ts`.
- `~/.<APP_SHORT_ID>/skills/` — cross-brain. Useful for users with multiple
  brains (work/personal). New `getUserSkillsDir()` helper.
- `skills-bundled/` — checked into the repo, shipped on `pnpm build`.
  Read-only; resolved relative to the app install dir.

### 4.2 Precedence

When two skills have the same `name`, the higher-precedence one wins:

1. `brain/skills/` (most specific — current brain)
2. `~/.<app>/skills/` (user global)
3. `skills-bundled/` (defaults)

The picker shows a small badge ("Brain" / "User" / "Built-in") so the user
can tell which copy they're editing.

### 4.3 Hot reload

The dev server watches `brain/skills/` and `~/.<app>/skills/` with
`chokidar`. On change, the in-memory registry rebuilds and any open
composer's picker subscribes via a tiny event. In prod, watch is on by
default too — there's no reason to make users restart the app to pick up a
new skill.

### 4.4 Discovery implementation

New module: `src/lib/skills/`.

```
src/lib/skills/
├── types.ts              # Skill, SkillSource, SkillRegistry
├── frontmatter.ts        # parse YAML frontmatter; reject unknown shapes
├── loader.ts             # walk dirs, merge sources, apply precedence
├── watcher.ts            # chokidar over the skill dirs
├── registry.ts           # singleton in-memory registry + subscribe()
├── substitute.ts         # $ARGUMENTS / $1 / {{vars}}
└── loader.test.ts
```

The loader is the only piece that touches disk. Everything else takes a
`Skill[]` in memory. This is the same shape as the orchestrator registry,
on purpose — they should feel like the same kind of object.

```ts
export type Skill = {
  name: string;
  description: string;
  aliases: string[];
  argumentHint?: string;
  whenToUse?: string;
  model?: string;
  userInvocable: boolean;
  allowedTools?: string[];
  body: string;                  // raw markdown after frontmatter
  source: 'brain' | 'user' | 'bundled';
  filePath: string;              // absolute, for "edit this skill" UX
};
```

## 5. Tiptap integration

The chat composer (`src/components/chat/editor/chat-input-editor.tsx`) gets
one new extension. No other change to the editor.

```
src/components/chat/editor/
├── chat-input-editor.tsx           (existing)
├── file-chip-node.tsx              (existing)
└── skill-suggestion/               (new)
    ├── extension.ts                # Tiptap suggestion config
    ├── popover.tsx                 # the picker (shadcn Command)
    ├── use-skill-registry.ts       # subscribe to the in-memory registry
    └── fuzzy.ts                    # Fuse.js with the Claude-Code weights
```

### 5.1 Trigger

We use `@tiptap/suggestion` with:

```ts
{
  char: '/',
  startOfLine: false,        // also triggers after whitespace
  allowSpaces: true,         // so the user can type "/triage finance"
  command: ({ editor, range, props }) => { ... }, // expand on select
  render: () => { ... }      // mount/update the popover via portal
}
```

`startOfLine: false` + a custom predicate: the trigger fires only when the
character *before* the `/` is whitespace, a paragraph boundary, or the
start of the doc. This means `https://foo` won't accidentally open the
picker, but `look at /triage` will.

### 5.2 Popover

A React portal anchored to the suggestion range's screen coordinates
(`@tiptap/suggestion` provides these). Internally we use shadcn `Command`
for keyboard nav, but bind Enter/Escape/Arrows manually rather than via
cmdk — because Tiptap owns the editor focus and we don't want focus to
leave the composer. The popover is *display-only*; the editor stays
focused.

Rendering layout:

```
┌────────────────────────────────────────────────────┐
│ /triage                            Brain · Cmd+E   │
│ Triage my inbox to today's tasks                   │
├────────────────────────────────────────────────────┤
│ /summarize                                Built-in │
│ Summarize a thread or task                         │
└────────────────────────────────────────────────────┘
```

`Cmd+E` on a highlighted row opens that skill's source file in the file
browser (open path comes from `Skill.filePath`). Cheap, valuable, and
turns the picker into a discovery surface for *editing* skills as well as
running them.

### 5.3 Filtering

Fuse.js index over the registry, rebuilt only when the registry changes.
Weights copied verbatim from Claude Code:

- `name` 3.0
- `aliases` 2.0
- `description` 0.5
- threshold 0.3

If the typed query is empty, we show all skills sorted by `description`.
If the query has no fuzzy hits, the popover shows "No skills match" and
the `/` stays in the editor — never silently consumed.

### 5.4 Selection / expansion

On Enter:

1. Delete the range from `/` to the caret.
2. Insert the expanded skill body at that position.
3. If the body contains `$ARGUMENTS`, position the caret at the slot and
   delete the token.
4. Close the popover.

On Shift-Enter:

5. Do steps 1–3, then call the existing submit handler.

On Esc: close the popover, leave the typed `/` in place.

The expansion is *plain text inserted into the editor*, not a magical
chip. The user can edit it, mix it with files, delete it. Auditable by
construction.

## 6. Agent surface integration

Skills are useful for the agent too: the orchestrator should be able to
list and invoke them. Two new actions in
`src/lib/orchestrator/registry.ts`:

- `list_skills` — returns `{ skills: Skill[] }`, filtered by `paths` if a
  workspace is in context. The agent's system prompt gets a one-liner per
  skill so it knows when to reach for them.
- `run_skill(name, args?)` — substitutes and returns the body as a
  prompt. Agent decides whether to follow it itself or recurse. This is
  not auto-execution — it's prompt assembly. Keeps the trust boundary
  clean.

Critically: **slash-menu and agent share one registry**. There is no
"agent-side skill" vs "UI-side skill". A skill author writes one file.

This is also why we keep `user-invocable: false` as a flag: some skills
are scaffolding for the agent (e.g. a "review the current diff" prompt
the agent runs internally) and shouldn't clutter the human's picker.

## 7. Bundled starter skills

Ship a small set in `skills-bundled/` so the menu isn't empty on first
run. Picked to demonstrate the range:

- `triage.md` — inbox → today/week/later
- `summarize.md` — summarize a thread or task
- `plan.md` — draft a weekly plan from current state
- `braindump.md` — capture freeform thoughts into the inbox
- `retro.md` — weekly retrospective from the stream
- `clarify.md` — agent asks me 3 questions to sharpen a vague task

These also serve as documentation-by-example. A user opens `triage.md` to
learn the format and writes their own.

## 8. Security

- Skills are markdown. They can't run code. The body is interpolated as
  text and sent to the model the same way any user-typed prompt would be.
- `allowed-tools` in a skill is **advisory to the agent**, not enforced.
  The orchestrator already has its own allowlist (the trust boundary
  is `ctx.remote`); a skill saying "allowed-tools: query" doesn't
  *grant* anything — it tells the model which tools are appropriate. The
  human still sees the expanded prompt before sending.
- The skill watcher only reads files under the three known roots. No
  symlink chasing outside those roots.
- File-name validation on load: skill names must match `^[a-z0-9-]+$`.
  Anything else is logged and skipped. This is the surface the URL/agent
  layer sees.

## 9. Error handling

The loader is **forgiving by design**. A bad skill file should never
break the picker:

| Condition                          | Behavior |
| ---------------------------------- | -------- |
| Missing frontmatter                | Skip, log once. |
| Missing required field (`description`) | Skip, log once. |
| Unknown frontmatter key            | Keep skill; ignore key. |
| YAML parse error                   | Skip, log once with file path. |
| Duplicate name within one source   | Last-wins; log. |
| Duplicate across sources           | Precedence rule (§4.2); not an error. |
| File > 256 KB                      | Skip, log. (Sanity cap.) |

The single `console.warn` per bad file goes through the existing
instrumentation logger so it surfaces in dev. We never toast skill
parsing errors — they'd be noise on every brain-sync.

## 10. Test plan

Unit:

- `frontmatter.test.ts` — valid file, missing field, unknown field,
  malformed YAML, body with leading whitespace.
- `loader.test.ts` — three-source precedence, name normalization,
  duplicate handling, size cap, hot reload event firing.
- `substitute.test.ts` — `$ARGUMENTS`, `$1`/`$2`, `{{date}}`,
  unknown `{{foo}}` left literal, args with quotes.
- `fuzzy.test.ts` — name beats description, alias hits, no-match path.

Integration:

- Render the composer with a fixture registry, drive it with
  `userEvent`: type `/`, see popover, arrow-down, Enter, assert the
  expanded body landed at caret.
- Open the composer with `/x` where `x` doesn't match anything: assert
  empty state and that the `/x` text stays in the doc.

Manual smoke (acceptance):

1. `pnpm dev`, open chat, type `/`, see bundled skills.
2. Drop a new skill at `brain/skills/foo.md`, see it appear without
   restart.
3. Edit the description in that file, see the picker update.
4. Use `/foo bar baz`, see `$ARGUMENTS=bar baz` substituted.
5. Trigger from mid-message after a space, confirm popover anchors to
   the caret, not the start of the doc.
6. `https://example.com` in the middle of a message does *not* trigger
   the picker.

## 11. Out of scope (for v1)

- Skill chaining / piping (`/triage | /summarize`).
- Skills that execute code or call HTTP endpoints directly. (Use the
  orchestrator registry for that.)
- A built-in skill editor UI. v1 opens the `.md` in the file browser
  (`Cmd+E` in the picker); users edit it like any note.
- `paths` glob filtering. Loader parses the field; the picker doesn't
  filter on it yet.
- Sharing / marketplace. Out for v1 — but the on-disk format is
  deliberately compatible with Claude Code's, so an importer is a small
  follow-on.
- Per-skill telemetry / usage counts.

## 12. File-by-file impact

New:

- `src/lib/skills/{types,frontmatter,loader,watcher,registry,substitute}.ts`
- `src/lib/skills/{loader,frontmatter,substitute,fuzzy}.test.ts`
- `src/components/chat/editor/skill-suggestion/{extension,popover,use-skill-registry,fuzzy}.{ts,tsx}`
- `skills-bundled/{triage,summarize,plan,braindump,retro,clarify}.md`

Edited:

- `src/lib/config/paths.ts` — add `getSkillsDir()`, `getUserSkillsDir()`,
  `getBundledSkillsDir()`.
- `src/components/chat/editor/chat-input-editor.tsx` — add the suggestion
  extension to the editor's `extensions:[…]`. ~5 lines.
- `src/lib/orchestrator/registry.ts` — register `list_skills` and
  `run_skill` actions.
- `package.json` — add `@tiptap/suggestion`, `gray-matter`, `fuse.js`,
  `chokidar` (already present? confirm).

Nothing else in the existing chat pipeline (paste handling, file chips,
marker output, ai-sdk parts) is touched. The slash menu is a pure
addition.

## 13. Sequencing

A reasonable order to implement and ship in slices, each independently
useful:

1. **Loader + registry + tests** — pure data, no UI. Verifies disk
   contract and lets the agent start using `list_skills` first.
2. **Bundled skills + paths helpers** — ship the starter files.
3. **Suggestion extension + popover + expansion** — the visible feature.
4. **Hot reload watcher** — quality of life; not blocking.
5. **Agent actions (`list_skills`, `run_skill`)** — closes the loop with
   the orchestrator surface.
6. **Picker Cmd+E "open source file"** — turns the menu into an authoring
   tool.

A user gets value after slice 3. Slices 4–6 are pure upside.

## 14. Open questions

- Should `model:` in a skill override the user's selected chat model
  *for that message only*, or *for the rest of the session*? Default
  proposal: **just that message** — least surprising, matches how
  "expand to text" frames the operation.
- Do we expose a `/` keyboard shortcut from anywhere in the app to focus
  the composer with `/` already typed? Cheap to add via `HOTKEYS` —
  worth doing as a polish item.
- For the cross-brain `~/.<app>/skills/` dir, do we ship a one-time
  migration that scans `~/.claude/skills/` and offers to symlink them in?
  Strongly considered, but defer until we see actual user demand.
