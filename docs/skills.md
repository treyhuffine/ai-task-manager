# Skills and the skill builder

A skill teaches agents one way of working: how you review a pull request,
triage an inbox, write the weekly review. It's a folder with a `SKILL.md`
(YAML frontmatter with `name` and `description`, then markdown instructions),
in the open Agent Skills format every harness Ri runs reads
([agentskills.io/specification](https://agentskills.io/specification)).

Ri keeps one library of them, lets you build them by hand or with AI, and
decides which chats get which skill.

Landed 2026-09-30.

## Naming: Plugins

The rail's catalog entry and the Settings section are **Plugins**. Inside,
the two kinds keep the names the rest of the market uses: **Skills** (know-how)
and **Connectors** (access to your accounts).

Why, as of September 2026:

- "Plugin" has become the name of the installable package across agent
  tools: Claude Code (bundles of skills, agents, hooks and MCP servers),
  Claude Cowork (January 2026), Cursor 2.5's marketplace (February 2026),
  GitHub Copilot's Agent Plugins 1.0 (August 2026), and OpenAI, whose
  ChatGPT App Directory became the Plugin Directory in July 2026 (reported,
  not confirmed first-hand).
- Nobody renamed connectors to plugins. Claude's own directory (Customize)
  has three tabs: Skills, Connectors, Plugins. A connector stays a single
  authenticated connection, and a plugin bundles skills and connectors.
- So "Plugins" works as the storefront word, and the parts keep their own
  names. If Ri ever installs real bundles, they appear on the same page as
  one more kind.

The section id stays `connectors`, because OAuth returns and connection
links deep-link to `?settings=connectors`.

## Where skills live

| What | Where | Who manages it |
| --- | --- | --- |
| The library | `<app-root>/skills/<name>/SKILL.md` | The skill builder, `src/lib/skills/` |
| Folder skills | `<agent folder>/.ri/skills/<name>/SKILL.md` | Whoever owns the repo |
| Shipped skills | generated into `<work-dir>/skills/` | `src/lib/agent-skills/shipped.ts` |
| Outside Ri | `~/.claude/skills`, `~/.agents/skills` | agentex links, or other tools |

The library is the one copy. It's portable home content (it travels with a
home backup), the folder name is the skill's identity (`name:` and its slash
command), and a rename moves everything that points at it.

App code never writes the library folder directly. It goes through
`src/lib/skills/manage.ts`, which keeps the folder, its reach, its links and
its chats in step.

## Reach: who uses a skill

One setting, four answers (`src/lib/skills/reach.ts`):

| Mode | Meaning | Stored as |
| --- | --- | --- |
| `all` | Every agent in Ri. The standard case. | No `skill_scopes` row |
| `everywhere` | Every agent in Ri, plus Claude Code, Codex and Cursor on this computer | No row, plus links in both user-level folders |
| `agents` | Only the listed agents, in their main chats and executions | A row with those workspace ids |
| `off` | No chat | A row with an empty list |

It's one setting, not an "in Ri" choice plus an "outside Ri" switch, because a
skill linked outside Ri is read natively by every Claude and Codex session,
Ri's included. "Only these agents" together with "outside Ri" would be a
promise Ri can't keep.

A skill with no row reaches every chat, which is where every hand-made skill
stood before this existed. New skills from the builder start **off**, so
nothing picks up a half-written one. "Turn on" moves them to `all`. A skill
with blocking problems (bad name, missing or oversized description, broken
frontmatter) can't be turned on.

The UI labels only the exceptions (Off, N agents, Also outside Ri). Every
agent gets no badge.

The desktop app (`RI_DESKTOP=1`) never writes outside itself, so
`everywhere` and importing are unavailable there.

## How a chat gets its skills

1. **The home decides.** `buildSessionSpec` (`src/lib/executor/session-spec.ts`)
   asks `sessionSkillExclusions` (`src/lib/skills/exclusions.ts`) which
   library skills this chat must not get, and puts them on the spec as
   `excludeSkills`. It's decided at home because the runner may be on another
   device without the database. A runner that predates the field attaches
   every library skill, as before.
2. **The runner resolves** (`src/lib/executor/skills.ts`,
   `resolveSkillsForSession`): library skills minus the exclusions, minus any
   skill linked into both user-level folders (every harness already reads
   those itself, and attaching twice would list them twice), plus the
   folder's own `.ri/skills`, which win on a name clash.
3. agentex attaches them (`skillDirs`): a temp dir with `--add-dir` for
   Claude, links in `<cwd>/.agents/skills` for Codex.

Two special chats, both `type='content'` chats from `/api/document-chat`:

- **Builder** (`surfaceKind='skill'`, `surfaceRef=<name>`): briefed by
  `src/lib/skills/builder-brief.ts` through session instructions (or ahead of
  the first message on a harness that drops them). It never gets the skill
  it's writing, so it edits the file instead of following it.
- **Try** (`surfaceKind='skill-try'`): an ordinary chat that always gets the
  skill it tries, even while it's off. That's how you test whether an agent
  actually reaches for it.

Codex leaves its `.agents/skills` links behind, so when a skill stops
reaching an agent (off, fewer agents, renamed, archived), `removeSessionLinks`
clears links pointing at that exact library folder from the app root, every
agent folder and every execution worktree.

A harness reads its skill list when its session starts, so a reach change
restarts the sessions it touches: only the agents added or removed for an
agent-list change, every agent's sessions plus the app's main chat when a
change involves every agent. Moving between `all` and `everywhere` restarts
nothing, since no Ri chat sees a difference. Restarts wait for a running
turn to end.

## The builder

Plugins opens with a **Build a skill** box. Say what the skill should do, then:

- **Draft with AI** (Enter): creates the skill off, named from your words,
  sends your text as the builder chat's first message, and opens the builder.
  The AI writes a full first draft right away, renames the draft if its
  first name is awkward, then asks one or two questions.
- **Write it yourself**: creates it with your text as the first description.

The builder view (`?skill=<name>`, `src/components/skills/`) is the agent
view's shape: chat on the left (Build and Try it), the skill on the right.

- **Fields** mode edits "When to use it" (the description, with a counter)
  and the instructions (CodeMirror, byte-exact markdown). **SKILL.md** mode
  edits the whole file, for keys like `allowed-tools`. A new `name:` there
  renames the skill.
- It autosaves. Every save carries the hash it was based on. With nothing
  unsaved, the AI's changes flow into the editor as they land (the view polls
  while the builder AI works). If the file changed under unsaved typing,
  nothing is overwritten: a banner offers the new version or yours.
- A rename by the AI or another tab is followed: the view looks up where
  the builder chat went and moves there.
- Problems come from `checkSkill` (`src/lib/skills/format.ts`). Errors block
  turning on, warnings are advice (empty or over-500-line instructions).

Field edits never reformat the rest of the file. The body is replaced
verbatim, and the frontmatter is only re-serialized (through the `yaml`
Document API, which keeps comments and order) when `name` or `description`
actually changes.

## Outside Ri

The Plugins page lists real skills in `~/.claude/skills` and
`~/.agents/skills` that Ri doesn't own (not a library link, not a shipped
skill, and containing a `SKILL.md`). A plain folder can be **moved into Ri**:
it's copied into the library, the original goes to
`<app-root>/.archive/skills-outside/`, and the library copy is linked back in
both folders, so every tool keeps finding it. A skill another tool links in
stays managed there.

## The agent's Setup tab

Its **Skills** section lists what the agent uses: skills limited to some
agents (or off) with a switch that adds or removes just this agent, skills on
for every agent without one, and the skills in the agent's own `.ri/skills`.

## Agent surface

Orchestrator actions (`src/lib/orchestrator/registry.ts`):

| Action | Notes |
| --- | --- |
| `list_skills` | Library skills now include `description` and `reach`. |
| `get_skill` | The file, its parts, problems, files, reach, and the `hash` to write against. |
| `create_skill` | Starts off. A retry with the same content returns the same skill. |
| `save_skill` | Fields, whole content, supporting `files`, `newName`. Pass `baseHash`: a stale save is refused with a hint to re-read. Refused from other devices. |
| `set_skill_reach` | Over MCP it can only narrow. Turning a skill on is the user's call. |

Writes go through the app server (`/api/skills/...`), because renames and
reach changes restart live sessions, which only the server can do.

HTTP: `GET/POST /api/skills` (`?workspaceId=` adds that agent's folder
skills), `GET/PUT/DELETE /api/skills/:name`, `PUT /api/skills/:name/reach`,
`POST /api/skills/outside/import`. Delete archives to
`<app-root>/.archive/skills/`.

## Not built yet

- **Adding a skill to a repo**, for sharing with a team: a copy committed
  into `<repo>/.claude/skills` and `.agents/skills`, which then evolves
  separately. Linking into repos was deliberately left out: links show up as
  untracked files and point at one machine's home if committed.
- **Skills on other devices.** A chat running on a connected device reads
  that device's own `<app-root>/skills`, and the library isn't synced there
  (this was already true of hand-made library skills). The spec carries
  exclusions, so reach is right once the files are there.
- **Plugin bundles.** Installing Claude Code or Cursor plugins (skills plus
  connectors plus commands) as one unit.
