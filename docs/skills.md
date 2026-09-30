# Skills and the skill builder

A skill teaches agents one way of working: how you review a pull request,
triage an inbox, write the weekly review. It's a folder with a `SKILL.md`
(YAML frontmatter with `name` and `description`, then markdown instructions),
in the open Agent Skills format every harness Ri runs reads
([agentskills.io/specification](https://agentskills.io/specification)).

Ri shows every skill you have, lets you build and edit them by hand or with
AI, and keeps them where the rest of your tools expect them.

Landed 2026-09-30. Reworked the same day to the location model below, after
the first version's "reach" settings (off, only some agents, also outside Ri)
proved harder to follow than the norms users already know.

## Where a skill lives is who uses it

Three places, the same ones Claude Code, Codex and the rest use:

| Place | Folder | Who uses it |
| --- | --- | --- |
| **Ri** | `<app-root>/skills/<name>` | Every chat Ri runs: the main chat, agents' chats, executions |
| **Global** | `~/.claude/skills/<name>`, linked into `~/.agents/skills` | Every agent on this computer, in Ri and outside it |
| **Project** | `<agent folder>/.claude/skills/<name>`, linked into `.agents/skills` | Agents working in that folder, and anyone who pulls the repo once it's committed |

There's nothing else to set: no on/off, no per-agent lists. To limit a skill
to one agent, put it in that agent's project. To share it with a team, add it
to the project and commit.

`.claude/skills` holds the real folder. The `.agents/skills` entry is a link to
it (relative inside a project, so it works in any clone), because Codex,
Cursor, Gemini, OpenCode and Pi read `.agents/skills` while Claude Code reads
`.claude/skills`. A skill someone put only in `.agents/skills`, or in a
project's older `.ri/skills`, is found and edited where it is.

A skill is named by a **ref**: `ri:<name>`, `global:<name>`, or
`project:<workspaceId>:<name>`. A bare name means a Ri skill. Refs are the
view's URL (`?skill=ri:weekly-review`), the API path, and the orchestrator
actions' parameter.

### What Ri shows

- Ri's skills: every folder in `<app-root>/skills` with a `SKILL.md`.
- Global skills: real folders in either global folder. A link another tool
  put there (pointing somewhere Ri doesn't manage) shows as **Linked** and is
  read only: edit it where it lives, or copy it into Ri. Ri's own shipped
  skills (`agent-work-tasks-notes_ri`, `agent-browser_ri`) aren't listed.
- Project skills: for each agent whose folder is on this computer. Links that
  Codex left in `.agents/skills` pointing at a Ri skill aren't listed: they're
  session leftovers, not project skills.

### How a chat gets them

- Ri's skills are attached to every chat Ri starts (agentex `skillDirs`,
  `src/lib/executor/skills.ts`).
- Global and project skills aren't attached: every harness reads those
  folders on its own, from the user's home and from the chat's working folder.
  An execution's worktree has the project's committed skills. An uncommitted
  one is only in the agent's own folder, where its main chat runs.
- Two chats differ, decided at home and carried on the session spec because
  the runner may be on another device (`src/lib/skills/exclusions.ts`): a
  skill's **builder** chat never gets the Ri skill it's writing
  (`excludeSkills`), and a **try** chat attaches the project skill it tries
  (`extraSkillDirs`), since it runs in Ri's home, not in that project.

## Naming: Plugins

The Settings section is **Plugins** (`?settings=plugins`; the old
`?settings=connectors` still opens it, since OAuth returns and links carry
it). Inside, the two kinds keep the names the rest of the market uses:
**Skills** (know-how) and **Connectors** (access to your accounts). The
database keeps "connectors" for the connections it stores, which is what they
are. The rail's entry is **Connect apps**, which opens Plugins scrolled to its
connectors.

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

## The builder

Plugins opens with a **Build a skill** box (an agent's Setup tab has the same
box, for that project). Say what the skill should do, then:

- **Draft with AI** (Enter): creates the skill (in Ri, or in the project),
  named from your words, sends your text as the builder chat's first message,
  and opens the builder. The AI writes a full first draft right away, renames
  it if the first name is awkward, then asks one or two questions.
- **Write it yourself**: creates it with your text as the first description.

The builder view (`?skill=<ref>`, `src/components/skills/`) is the agent
view's shape: chat on the left (Build and Try it), the skill on the right.

- The header says where the skill lives. Its menu moves it to Ri or global,
  or adds it to a project (a copy, leaving this one). A project skill with
  changes the repo hasn't committed gets **Commit to <branch>**, which commits
  only that skill's folder and link, leaves anything else staged or changed
  alone, runs the repo's hooks, and never pushes.
- **Fields** edits "When to use it" (the description, with a counter) and the
  instructions (CodeMirror, byte-exact markdown). **SKILL.md** edits the whole
  file, for keys like `allowed-tools`. A new `name:` there renames the skill.
- It autosaves. Every save carries the hash it was based on. With nothing
  unsaved, the AI's changes flow into the editor as they land (the view polls
  while the builder AI works). If the file changed under unsaved typing,
  nothing is overwritten: a banner offers the new version or yours.
- A rename or move by the AI or another tab is followed: the view looks up
  where the builder chat went and moves there.
- Problems come from `checkSkill` (`src/lib/skills/format.ts`): the name
  rules, a missing or oversized description, broken frontmatter, and advice
  like over-500-line instructions.

Field edits never reformat the rest of the file. The body is replaced
verbatim, and the frontmatter is only re-serialized (through the `yaml`
Document API, which keeps comments and order) when `name` or `description`
actually changes.

## Agent surface

Orchestrator actions (`src/lib/orchestrator/registry.ts`):

| Action | Notes |
| --- | --- |
| `list_skills` | Every skill with its `ref` and location. With `workspaceCwd`, only what a chat there gets. |
| `get_skill` | The file, its parts, problems, files, and the `hash` to write against. |
| `create_skill` | In Ri. Global or a project only from the app or the local CLI. A retry with the same content returns the same skill. |
| `save_skill` | Fields, whole content, supporting `files`, `newName`. Pass `baseHash`: a stale save is refused with a hint to re-read. Refused from other devices. |
| `move_skill` | Move, or copy with `copy`. Only from the app or the local CLI: writing outside Ri is the user's call. |

Writes go through the app server (`/api/skills/...`), because a rename or
move restarts the skill's chats, which only the server can do.

HTTP: `GET/POST /api/skills`, `GET/PUT/DELETE /api/skills/:ref`,
`POST /api/skills/:ref/move`, `POST /api/skills/:ref/commit`. Delete archives
to `<app-root>/.archive/skills/`.

## Code map

| File | What |
| --- | --- |
| `src/lib/skills/format.ts` | Parse, check and write SKILL.md without losing anything |
| `src/lib/skills/library.ts` | File work on one skill folder: atomic writes, stale checks, move, copy, archive |
| `src/lib/skills/locations.ts` | The three places, refs, discovery, the `.agents/skills` links |
| `src/lib/skills/git.ts` | Uncommitted project skills, and committing one |
| `src/lib/skills/manage.ts` | Everything the routes and actions do, keeping folders, links and chats in step |
| `src/lib/skills/exclusions.ts` | What a builder or try chat gets differently |
| `src/lib/skills/builder-brief.ts` | The builder chat's brief |

## Not built yet

- **Skills on other devices.** A chat running on a connected device reads that
  device's own Ri skills folder, and Ri's skills aren't synced there (true of
  hand-made skills before this, too). Global and project skills work there as
  anywhere, from that device's own folders.
- **Plugin bundles.** Installing Claude Code or Cursor plugins (skills plus
  connectors plus commands) as one unit.
