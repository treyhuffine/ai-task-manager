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
proved harder to follow than the norms users already know. Drafts landed
2026-10-02: a skill is written before it's installed, so a half-written one
never reaches an agent.

## Written as a draft, installed where it's used

Every new skill starts as a **draft** in `<app-root>/skill-drafts/<name>`.
No harness reads that folder, so no agent uses a draft, however unfinished.
The user installs it when it's ready, or the AI helping them does, when they
ask. Installing moves the folder to one of three places, the same ones
Claude Code, Codex and the rest use, and where it's installed is who uses it:

| Place | Folder | Who uses it |
| --- | --- | --- |
| **Ri** | `<app-root>/skills/<name>` | Every chat Ri runs: the main chat, agents' chats, executions |
| **Global** | `~/.claude/skills/<name>`, linked into `~/.agents/skills` | Every agent on this computer, in Ri and outside it |
| **Project** | `<agent folder>/.claude/skills/<name>`, linked into `.agents/skills` | Agents working in that folder, and anyone who pulls the repo once it's committed |

There's nothing else to set: no on/off, no per-agent lists. To limit a skill
to one agent, install it in that agent's project. To share it with a team,
install it in the project (or add a copy there) and commit. To take it away
from every agent without losing it, uninstall it: it goes back to the
drafts.

Installing needs a skill agents can load: nothing flagged as an error (a
name that matches its folder, a description, frontmatter that parses). A
draft can be anything while it's being written. Uninstalling never needs
that.

`.claude/skills` holds the real folder. The `.agents/skills` entry is a link to
it (relative inside a project, so it works in any clone), because Codex,
Cursor, Gemini, Antigravity, OpenCode and Pi read `.agents/skills` while Claude
Code reads `.claude/skills`. A skill someone put only in `.agents/skills`, or in a
project's older `.ri/skills`, is found and edited where it is.

A skill is named by a **ref**: `draft:<name>`, `ri:<name>`, `global:<name>`,
or `project:<workspaceId>:<name>`. A bare name means a Ri skill. Refs are the
view's URL (`?skill=ri:weekly-review`), the API path, and the orchestrator
actions' parameter. Installing, moving or uninstalling changes the ref, and
the skill's chats follow it.

### What Ri shows

- Drafts: every folder in `<app-root>/skill-drafts` with a `SKILL.md`,
  first on the Skills tab, since they're waiting on you.
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
  `src/lib/executor/skills.ts`). Drafts never are. How a harness takes them
  is agentex's business: Claude gets a temporary folder, Codex links them
  into the chat's `.agents/skills` (so an agent's main chat on Codex gets
  none), OpenCode gets them through its session config, and Antigravity
  links them into its own global folder, `~/.gemini/antigravity-cli/skills`.
  Cursor sessions don't take them yet (agentex reads `skillDirs` only on
  Cursor's one-shot path).
- Global and project skills aren't attached: every harness reads those
  folders on its own, from the user's home and from the chat's working folder.
  An execution's worktree has the project's committed skills. An uncommitted
  one is only in the agent's own folder, where its main chat runs.
- Two chats differ, decided at home and carried on the session spec because
  the runner may be on another device (`src/lib/skills/exclusions.ts`): a
  skill's **builder** chat never gets the Ri skill it's writing
  (`excludeSkills`), and a **try** chat attaches the draft or project skill
  it tries (`extraSkillDirs`): nothing reads a draft, and a try chat runs in
  Ri's home, not in the project.

## Naming: Plugins

The Settings section is **Plugins** (`?settings=plugins`; the old
`?settings=connectors` still opens it, since OAuth returns and links carry
it). It has two tabs named for the two kinds, as the rest of the market names
them: **Connectors** (access to your accounts, the default tab) and
**Skills** (know-how). The tab labels live in one list in
`src/components/settings/sections/plugins-section.tsx`, so renaming a kind is
one line. The database keeps "connectors" for the connections it stores,
which is what they are. The rail's entry is **Connect apps**, which opens
Plugins on its Connectors tab. Links about a skill open the Skills tab
(`openSettings('plugins', { anchor: 'skills' })`).

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

**New skill** sits at the right of the Plugins tabs, there on either tab, and
in the Skills section of an agent's Setup tab. It starts a draft named
`new-skill` and opens it in the builder straight away. Clicking it again
before anything is written opens the same blank draft (nothing in the file
and nothing said in its chats), so walking away never leaves a pile of empty
ones.

The builder view (`?skill=<ref>`, `src/components/skills/`) is the agent
view's shape: chat on the left (Build and Try it), the skill on the right.
Write it by hand, tell the AI what it should do in Build (it writes a full
first draft, names it, then asks one or two questions), or both.

- The header is the skill's name (click to rename) and one control for where
  it's installed, which carries the location so nothing else repeats it. On a
  draft it's **Install**, a menu of the places: Ri, Global, or a project. On
  an installed skill it names the place, and the same menu moves it (with a
  check on where it is now), adds a copy to a project to share it with that
  repo's team, or uninstalls it back to a draft. While something's flagged
  as an error, the install and move choices are off and the menu says why.
- A project skill with changes the repo hasn't committed gets **Commit to
  <branch>**, which commits only that skill's folder and link, leaves
  anything else staged or changed alone, runs the repo's hooks, and never
  pushes.
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
| `list_skills` | Every skill with its `ref` and location, drafts included. With `workspaceCwd`, only what a chat there gets (no drafts). |
| `get_skill` | The file, its parts, problems, files, and the `hash` to write against. |
| `create_skill` | A draft, unless `location` installs it right away. A retry with the same content returns the same skill. |
| `save_skill` | Fields, whole content, supporting `files`, `newName`. Pass `baseHash`: a stale save is refused with a hint to re-read. Refused from other devices. |
| `move_skill` | Install a draft, move an installed skill, or uninstall it (`to: "draft"`). `copy` keeps the original. A retry that already landed returns the skill. |

Writes go through the app server (`/api/skills/...`), because a rename or
move restarts the skill's chats, which only the server can do.

Installing is the user's call, made in the editor or by asking an agent. The
builder chat's brief tells its AI to install only when asked, and to ask
where. Any caller on the home may install or move a skill (`move_skill`, or
`create_skill` with a location): the app, the local CLI, and the home's own
agent chats, the builder among them. A gate stricter than that would add
friction and no safety, since an agent on the home can already write those
folders through its shell. Callers on other devices are refused, because the
folders are the home's (docs/homes-spec.md §4.1). They can still create a
draft, which nothing uses.

HTTP: `GET/POST /api/skills`, `GET/PUT/DELETE /api/skills/:ref`,
`POST /api/skills/:ref/move`, `POST /api/skills/:ref/commit`. Delete archives
to `<app-root>/.archive/skills/`. Drafts are home content like Ri's skills:
home backups and comparisons include `skill-drafts` (`src/lib/home/`).

## Code map

| File | What |
| --- | --- |
| `src/lib/skills/format.ts` | Parse, check and write SKILL.md without losing anything |
| `src/lib/skills/library.ts` | File work on one skill folder: atomic writes, stale checks, move, copy, archive |
| `src/lib/skills/locations.ts` | The drafts and the three places, refs, discovery, the `.agents/skills` links |
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
