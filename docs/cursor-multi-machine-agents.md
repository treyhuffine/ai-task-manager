# Running agents across machines: what Cursor, Claude Code and Codex do

**Written:** 2026-09-23. Research notes behind `docs/homes-spec.md` §6.4 to §6.8.
**Question:** Ri needs agents to run on your home (an always-on Mac Mini) and on the laptop you're sitting at, and it has to feel effortless, with no commands to learn. Cursor is the closest reference. Claude Code and Codex matter too, because they are the harnesses Ri runs.

---

## 1. Cursor (Agents Window, Cursor 3, April 2026)

### What the composer shows

From two screenshots of Cursor's Agents Window (taken 2026-09-23):

- **A source picker** ("Start from scratch ▾") with a search box ("Search repos, cloud environments…"):
  - **Recents:** folders like `insiderfinance`, `podcast-summarizer`, `racketready`
  - **Repos, grouped by place:** **On This Mac**, **Remote** (a cloud icon), **raspi** (a connected machine)
  - **Start from scratch**, **Use Existing…**, **New Folder**
- **A "Run on" picker** ("This Mac ▾"):
  - **This Mac** (checked)
  - **Remote Machine ▸**, which opens a search box ("Search Remote Machines…"), "No remote machines yet", and **Connect via SSH**
- **The prompt box,** with a model chip ("Cursor Grok 4.6 Medium"), a mic button, and two suggestions: "Plan New Idea" and "Multitask".

**The key idea: "what" and "where" are two separate choices.** You pick a repo (grouped by the machine it lives on), and separately pick the machine that runs the agent.

### How it works

- **Environments:** local, worktree, cloud, and remote SSH, all in one window ([Agents Window docs](https://cursor.com/docs/agent/agents-window), [Cursor 3 guide](https://www.digitalapplied.com/blog/cursor-3-agents-window-complete-guide)).
- **Machines join as workers.** One command (`agent worker start`) registers a named worker that "opens a long-lived outbound HTTPS connection that Cursor never initiates inbound". You then start and control agents on it from the web or a phone ([self-hosted machines](https://www.startuphub.ai/ai-news/artificial-intelligence/2026/cursor-self-hosted-machines-move-agents-on-prem), [remote agents](https://www.buildfastwithai.com/blogs/cursor-remote-agents-any-device-2026), [announcement](https://x.com/cursor_ai/status/2041912812637966552?lang=en)).
- **Brain and hands are split.** "The agent loop moves to the cloud while its tools keep running on your machine, so it reads your files, runs your tests, and uses your local setup" ([Product Compass](https://www.productcompass.pm/p/cursor-remote-control)). The conversation lives in Cursor's cloud, never on the machine.
- **"Move to" moves the branch and the conversation.** Staff confirm a handoff transfers "the repository branch associated with the agent" and "chat context and conversation history" ([forum](https://forum.cursor.com/t/cloud-origin-agents-have-no-move-to-machine-option-in-agents-window-glass-cant-hand-off-to-local/162470)). The move goes both ways: start locally and hand off to the cloud to keep working while you're offline, or pull a cloud agent back to iterate locally ([cloud agents](https://cursor.com/docs/cloud-agent), [local vs cloud](https://www.learncursor.dev/guides/local-agent-vs-cloud-agent)).
- **The target machine must already know the repo.** Moving from the cloud to a local machine only works "when there's already a local agent for the same repo". Cursor picks targets from local agents that match the project, and has no fallback for repos the machine hasn't seen ([forum](https://forum.cursor.com/t/cloud-origin-agents-have-no-move-to-machine-option-in-agents-window-glass-cant-hand-off-to-local/162470)). This is the same folder-mapping problem Ri has.
- **Sleep.** Remote Control "holds off idle sleep while a device is linked, so a turn you started from the phone survives the screensaver. A closed lid still suspends" ([Product Compass](https://www.productcompass.pm/p/cursor-remote-control)).
- **Cloud agents** clone the repo, work on a branch, and push it for handoff ([cloud agents](https://cursor.com/docs/cloud-agent)).

## 2. Claude Code

- **Remote Control:** the session keeps running on your machine, with your files, tools and MCP servers. You drive it from a phone or browser, and the conversation stays in sync across every connected surface ([Remote Control docs](https://code.claude.com/docs/en/remote-control)).
- **Teleport:** `claude --teleport` pulls a cloud session down to your terminal. It "fetches the branch, checks it out and picks up the conversation with its full context" ([Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web), [walkthrough](https://dev.to/proflead/claude-code-tutorial-syncing-web-sessions-to-local-cli-34e0)).
- **Teleport is one-way.** You can't push a local terminal session to the cloud. The manual workaround (summarize, commit, restart) "loses the conversational scaffolding" ([feature request](https://github.com/anthropics/claude-code/issues/56687)).

## 3. Codex app

- **Three modes:** Local, Worktree and Cloud. Both Local and Worktree chats run on your computer ([worktrees](https://developers.openai.com/codex/app/worktrees), [environments](https://developers.openai.com/codex/environments/modes)).
- **Handoff** "moves a chat between Local and Worktree, with Codex handling the Git operations required to move your work safely between them" ([worktrees](https://developers.openai.com/codex/app/worktrees)).
- **Local environments** hold setup scripts that run when a worktree is created ([local environments](https://developers.openai.com/codex/app/local-environments)), much like Ri's worktree scripts.

---

## 4. What Ri takes

1. **Two choices, not modes.** "What" is the agent. "Where" is a **Run on** chip. Local isn't a separate mode, it's just the chip set to this computer.
2. **Machines join as workers.** A connected computer runs a background worker that keeps an outbound connection to the home, so the home never has to reach the laptop through a firewall. You control it from any device.
3. **Move is one action, and the branch always moves.**
4. **Ri finds the repo on the target instead of refusing.** Cursor only offers a move when the target already knows the repo. Ri asks the target's worker to find it (in folders where the harness has run, or common code folders), and offers to clone it when it's missing.
5. **Keep the computer awake while an agent works.** Closing the lid still pauses it, and the app says so and offers to move the work home.
6. **The folder picker groups folders by machine,** with Recents first.

## 5. What Ri can't copy directly

- **The brain and hands split.** Ri runs Claude Code and Codex, whose loop runs wherever they're started and keeps the conversation in local files. So in Ri, a conversation moves only if the harness session file moves with it, the way teleport does. That's an open question, tested by a spike (`docs/homes-spec.md` Phase 9). Until then, a move starts a fresh harness session in the same Ri chat, seeded with a note about where things stand. The home already has every message, so the note can always be written, even when the source computer is offline.
- **A vendor cloud.** Ri's "cloud" is your home, or hosting later. The data stays yours.

## 6. What Ri deliberately keeps different

- **The home is the control plane,** not a vendor service.
- **Phones and browsers never run agents.**
- **No fleet.** This is a home plus the computers you sit at, as `docs/workspaces-spec.md` put it in its "Deferred: cross-machine execution" section.
