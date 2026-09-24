# One Ri: the mental model for your computers and your teams

**Written:** 2026-09-23. Historical decision memo and experiment record. The [homes build specification](homes-spec.md) is the sole build contract for this feature. This memo is background, not additional requirements.

**Evidence boundary:** The reported harness tests used one Mac Mini with changed folders and transcript locations. They support further testing, not a verified promise of cross-machine native resumption. Preserve the observations in section 5. Use [the current native-session policy](homes-spec.md#84-native-session-transfer) for implementation decisions.

---

## 1. The question

Two Ri instances exist today: the real home on the Mac Mini, reached at a Beamd address, and a second home on the laptop at localhost. They share nothing. The question is what one Ri should feel like across those two computers and a phone, how teams fit into the same picture, and how to get there without building more than "git pull plus a little smart product work."

The parts that would not resolve:

- One instance that feels the same everywhere, yet execution lives on one specific machine.
- The harness conversation lives on one machine. The database lives on the server. Execution can be on either.
- An agent has a folder, and each machine has its own folder for the same project, so the machine can't be the source of truth.
- Is the answer a toggle between "pointing at remote" and "pointing at local"? Two instances, or one app?
- Could tasks and notes be shared while executions and agents stay per device?

## 2. What doesn't move

Four facts no design can change, and one that turned out to be softer than assumed.

1. **Data can live in one place and be reached from anywhere.** Already true: the Mac Mini home is at `ri-trey.beamd.run`, and phones and browsers pair to it today.
2. **Code work happens in a folder on one computer.** Folders are per machine by nature. Git already moves code between machines. This is the substrate, not a problem to solve.
3. **A harness session is a process on one computer, reading one folder.** Claude Code and Codex both run their loop where they are started.
4. **A person is at one computer at a time, plus a phone.** Anything bound to a screen or a port (the in-app terminal, a preview on localhost, Open in Cursor) only works on the computer that has the files.
5. **Softer than assumed: the harness's conversation is a portable file.** §5 has the test.

## 3. The model in one sentence

**Ri is one place. Your computers are hands.**

- The **home** is where everything *is*: tasks, notes, agents, every chat, and the record of every execution.
- A **computer** is where work *happens*. Any computer you connect can do work for the home.
- A **phone or browser** is where you *watch and steer*.
- Every piece of running work shows which hands hold it. Handing it to other hands is one gesture.

The Apple feature that matches is not iCloud sync. It is the **AirPlay output picker**. The music library is one thing. A small icon shows where the music is playing right now: this Mac, the HomePod, the Apple TV. You tap it to move playback, and the song keeps going. Nobody calls that "switching to HomePod mode." The library is not located. Playback is. In Ri, the home is not located. An execution is. **Run on** is the output picker. **Move to** is changing the output mid-song.

Two conclusions follow, and they answer most of the question:

- **There is no local mode and no remote mode.** You never toggle to your local machine. You open the same Ri everywhere. At the laptop, the only visible difference is that "This MacBook" appears as a choice in the picker.
- **Place is a property of an execution, never of a session or the app.** A global toggle is what makes multi-device products feel like two products. Cursor's Agents Window and the Codex app both put the choice on the individual agent or chat, not on the app (`docs/cursor-multi-machine-agents.md` §1 and §3). Keep "on this MacBook" as a filter you can tap. Never make it a state you are in.

## 4. What it feels like, in five moments

1. **At the laptop, typing a task.** The menu bar icon (or a bookmark) opens the home. Same rail, same deck, same chats as on the Mini. You type the task. The composer shows one small chip, "Run on: Mac Mini". You leave it, or tap it and pick "This MacBook". Send. Nothing else is different.
2. **Closing the lid.** The execution card reads "MacBook · asleep". One tap: Move to Mac Mini. The work continues. The chat is one unbroken thread.
3. **On the phone.** The same list. Executions on the laptop carry a chip. You read, answer a question, approve a permission. You do not know or care which machine answers, except that the chip tells you.
4. **Pulling work down to look at it.** An agent on the Mini has been working on a branch. You are at the laptop. On the execution: **Open on this MacBook**. The laptop fetches the branch into its own worktree and opens your editor. The agent keeps running on the Mini. If you commit and push, the execution shows "MacBook pushed 2 commits" with a Pull. This is `git pull` with a button on it. Only the code moved. You **Move** only when you want the agent here too, for a fast local loop, a preview, or tests against local services.
5. **A teammate.** Rob opens the InsiderFinance space link on his phone, types his name, and sees the board. He assigns you a task. It appears in your deck with a small colored dot. You start it with your agent on whichever computer you like. When it is done, the space shows done. Rob never sees your home, your other spaces, or your deck.

## 5. The conversation does move (tested 2026-09-23)

The spec's biggest open question (Decision 14, Phase 9) is whether a harness conversation can follow work to another machine. Both harnesses were tested on the Mac Mini, folder A to folder B, with the transcript file moved by hand to simulate arriving from another machine. Everything below was observed, not read from docs.

**Claude Code 2.1.280**

- The session file lives at `~/.claude/projects/<escaped original cwd>/<id>.jsonl`.
- `claude --resume <id>` from a different folder found the session and answered from its memory. The lookup is by id across every project folder, not by the current folder.
- Resumed turns append to the same file, record the new cwd, and tools run in the new cwd (`pwd` printed the new folder).
- The file was then moved into a project folder for a path that does not exist on this machine (`-Users-someone-else-dev-otherproject`). Resume from B still worked, and the file stayed where it was put. So on another machine: drop the file under any `~/.claude/projects/<anything>/` and resume by id. This is what `--teleport` does.

**Codex 0.153.4**

- The session file lives at `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl`. It is indexed by path in `~/.codex/state_5.sqlite`, table `threads`, column `rollout_path`.
- `codex exec resume <id>` from a different folder worked, and tools ran in the new folder.
- With the index row deleted (a machine that has never seen the thread) and the file left in place, resume worked and Codex re-created the index row. With the file also moved to a date folder that does not match its name, resume still worked and the index recorded the new path. So a file arriving from another machine works.
- The one failure: a file moved *after* it was indexed, leaving a stale path. That is not the cross-machine case.

**What this changes.** A move is: push the branch, copy one file, resume by id in the new worktree. The remaining risks are soft. Harness versions may differ between machines, and the conversation's content holds absolute paths from the old machine ("I edited /Users/agent/code/x/foo.ts"). The move note covers the second ("Your folder is now /Users/trey/dev/x"). Recommendation: **carry the session by default, and use the note as the fallback.** Run the ten-trial cross-machine check as confirmation, not as a gate. That flips Decision 14.

Two things make the fallback cheap. `docs/chat-sessions.md` already lists "machine changed" as a rollover trigger with a handoff message, so the fallback path was designed before this question was asked. And the home already holds every message, because workers stream events to it, so the note can always be written even when the source computer is asleep.

## 6. The alternatives, weighed

**A. Two instances that share tasks and notes.** "Notes and tasks are shared, but executions and agents stay per device." This sounds simpler and is the most expensive option on the table. It costs two databases, a two-way sync between two copies of the same person's data, conflict handling, and two chat histories. It gives a phone that has to choose which instance to look at, two rails, and "where did I start that?" The price is visible in the spec: Stage 2's `sync_sources`, `change_log`, `sync_outbox`, and the field split are what "shared tasks between two homes" costs. Spending that on your own two machines buys a worse experience than one home. Reject.

**B. A global toggle between remote and local.** Rejected in §3. Keep the filter, never the mode.

**C. One app that connects everywhere.** This is the model, and it is mostly true today. The app is the home's web UI at its address. On a computer there is one extra piece, a small resident worker that gives the home hands. It needs no UI of its own beyond a menu bar icon that opens the home and shows "running 1 agent". Electron for the UI is unnecessary. A signed menu bar app for the worker is what finally makes "nobody types a command" true. Do not build it yet, but treat it as the finish line for seamless, not as Phase 26 polish.

**D. No worker, just git and the CLI.** This is takeover, already built. It fails the bar: the home cannot reach the laptop through a router, so without a resident process every laptop action is a command you paste. The worker is not extra machinery. It is the existing executor minus the database, plus a command channel. Cursor's `agent worker` and Claude Code's Remote Control are the same shape.

## 7. The folder problem is smaller than it feels

"The agent has an identity and a folder, each machine has its own folder for it, so we can't take truth from the machine."

Right, and the resolution is to stop looking for one truth. Split the agent into what is the same everywhere and what is per machine:

- **Same everywhere, in the home:** name, instructions, scripts, connectors, base branch, and the git remote. This is the agent's identity. The remote is its fingerprint.
- **Per machine, one row per computer:** the folder. The machine reports it, the home records it.

The database holds facts per (agent, computer), never a single path. Truth is per machine by design, which is exactly what the spec's `workspace_folders` encodes (§6.5). The feel: the first time you pick "This MacBook" for an agent, Ri looks where Claude Code and Codex already ran on that machine, matches the remote, and asks once, "Use ~/dev/insiderfinance?" One tap. The question never comes back.

The only reason a source folder matters on a second machine is secrets (`.env`) and the setup script. Ri's worktrees already live in Ri's own per-machine location. When a repo has nothing to copy, "Clone a fresh copy" is enough and no question is needed.

## 8. Teams, on the same picture

Two axes, and they never share a control:

- **Scope** is *whose* work: Personal, Family, InsiderFinance. A pill in the top bar and a colored dot on a task. It is about what.
- **Place** is *which computer* runs an execution. A chip on the execution. It is about where.

A space is another home with people in it. Your home connects to it and pulls in what is yours. That is the spec (§6.11 to §6.14), and it fits the picture.

One intersection needs a rule, and it is worth setting now: **work on a space's task runs in your home, with your agents, on your computers.** The synced task is in your home. "Start with agent" uses your agent. The space sees the outcome (status, PR link, a summary) through sync, not the live execution. Space-owned agents, the groundskeeper and a Slack bot, run on the space's machine and belong to its admins. This keeps "a computer belongs to one home" true, lets you run InsiderFinance work on your laptop, and means a space needs no execution surface in v1. What Rob may actually want, to watch a diff and comment, becomes "share a read-only view of this execution" later. That is a link, not an architecture.

For the two or three person case (Ryan on Ball Coach, Rob on InsiderFinance): one space per project, each in its own root on the Mini beside your home. Your home connects to each. Two extra pills in your top bar, nothing else changes.

## 9. What this means for the spec

**Keep.** One home. Devices without databases. A worker per computer. Run on as a chip. One agent with a folder per computer, matched by remote. Spaces as homes. The empathy holds and the physics agree.

**Change.**

- **Decision 14:** carry the harness session by default, note as the fallback (§5).
- **Add "Open on this computer"** as a gesture separate from Move. It fetches the execution's branch into this computer's worktree and opens the editor, and leaves the agent where it is. Show "MacBook pushed N commits" on the execution with a Pull. Most of "pull the work down" is this, not a move. It is a subset of Move's steps 3 and 5 with no stop, no note, and no session handoff.
- **State the space-execution rule** from §8 in the Decisions list.
- **Run on default:** home first, then the last choice per agent, as the spec says. Add the honest failure: when a computer cannot reach the home, say "Can't reach your home." No offline mode, because agents need the network anyway.

**Defer**, to stay close to "git pull plus product work":

- mDNS discovery. Typing the address or scanning a code is fine.
- Moving a home over the network (Phase 11). The export is the safety net, and the home is already where it should be. Moving a home is a once-a-year event.
- Hand-started sessions and history import through the worker (Phase 8). Good, and unrelated to the two-instance pain.
- Approve-to-connect (`device_requests`). The QR code and link work today. Bring it back when someone other than you connects a computer.

**The shortest path to "the laptop and the Mini are one Ri":**

1. `ri agent` on the laptop talks to the home (Phase 3). This removes the phantom home the Ri skill writes into today.
2. Retire the laptop's home and connect the laptop as a device with the pairing that exists (Phase 12, without waiting on Phases 10 and 11).
3. The worker (Phase 4), folders per computer (Phase 5), the Run on chip and place chips (Phase 6).
4. Open on this computer, then Move with the session carried (Phase 7).

## 10. What only you can decide

- Whether "Open here" and "Move here" are two gestures or one gesture with an option. This memo says two.
- Whether the Run on default is the home or the computer you are sitting at. This memo says the home: it survives the lid, and the sticky per-agent choice covers "I always preview Ball Coach locally."
- Whether the menu bar app comes before a second person connects a computer.
