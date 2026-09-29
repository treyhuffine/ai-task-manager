# Switching your real Ri to homes

The one-time switch from today's setup (a Ri home on the Mac Mini, and another on the MacBook) to one Ri on the Mac Mini with the MacBook running its work. Written for Trey's two computers. It needs a separate go-ahead, and nothing here runs until then (docs/homes-spec.md §10.4).

What it does:

- The Mac Mini's Ri moves to the homes build: the same data, upgraded, with the Mini as its home.
- The chats started on the MacBook come into it, placed on the MacBook, where their folders and native sessions are (P5.1, rehearsed).
- The MacBook's own home is retired: its data kept in its folder, never started again, and the same folder becomes the MacBook's worker, its worktrees where they are.

Code and data, separately:

- **Code** is the homes build, on main. Both computers run it.
- **Data** moves once: the Mini's database is upgraded in place, and the laptop's chats are copied into it. Folders, worktrees and native transcripts never move.

## Before the day

1. **The homes build is on main.** Nothing to do: it was merged on 2026-09-29.
2. **Room on the Mini's disk:** at least 8 GB free, for the backup (about 6 GB). `df -h ~` shows it.
3. **The laptop's unpublished work** is known: `pnpm tsx scripts/unpublished-work.ts ~/ri` on the MacBook (it only reads). None of it moves, and continuing its execution finds it.
4. **Pick a quiet moment:** executions finished or fine to pause. Anything mid-turn stops when Ri stops.

## On the Mac Mini: one stop, five steps

All in the live checkout (`~/ai-task-manager`), with production stopped for the whole window.

1. **Stop Ri.** Ctrl-C where it runs (`pnpm cli:dev start`).
2. **Back up, and check it:**
   ```
   cd ~/ai-task-manager
   B=~/ri-backups/ri-pre-homes-$(date -u +%Y%m%dT%H%M%SZ)
   pnpm tsx scripts/home-backup.ts backup ~/ri "$B"
   pnpm tsx scripts/home-backup.ts verify "$B"
   ```
   It must say "backup verifies". This backup is the way back.
3. **Update the code:**
   ```
   git checkout main && git pull --ff-only && pnpm install && pnpm build
   ```
4. **Bring in the laptop's chats.** The laptop stops using its Ri first (see below, step 1), then makes a final backup and copies it here. Then:
   ```
   L=~/ri-backups/laptop-final-<time>
   pnpm tsx scripts/home-backup.ts verify "$L"
   pnpm tsx scripts/import-home.ts "$L" --device MacBook --map 019f9547-81be-70e0-8bfb-c04c1dc5792a=019e4cdd-3c13-7646-9320-46c1de0e0cf7
   ```
   That only says what it would do (the database is brought up to the homes build and gets its identity, as a first start would). Check it: about 245 chats, the laptop's `insiderfinance` joining `insiderfinance-app`, 5 agents new here, no problems. Then the same command with `--apply`.
5. **Start Ri:** `pnpm cli:dev start`. Then check: it opens, `pnpm cli:dev home show` says it runs on the Mac Mini, and an imported laptop chat reads as it did.

## On the MacBook

1. **Stop its Ri**, and **back it up** (read-only), then copy the backup to the Mini's `~/ri-backups/`. From here until it's retired, don't use the laptop's Ri: anything made there after the backup stays in its retired data.
   ```
   cd <your Ri checkout on the MacBook>
   git checkout main && git pull --ff-only && pnpm install
   OUT=~/ri-backups/laptop-final-$(date -u +%Y%m%dT%H%M%SZ)
   pnpm tsx scripts/home-backup.ts backup ~/ri "$OUT"
   rsync -a "$OUT" agent@100.95.238.26:ri-backups/
   ```
2. **After the Mini's step 5, retire the laptop's home.** Its data stays in `~/ri/.retired/`, and everything else stays where it is:
   ```
   pnpm cli:dev home retire --to "My Ri on the Mac Mini"
   ```
3. **Connect it and run work.** On the Mini, open Settings, Devices. The import made a device named MacBook: use its link button (New pairing link) and copy the link. On the MacBook:
   ```
   pnpm cli:dev connect '<that link>'
   pnpm cli:dev worker enroll
   pnpm cli:dev worker run
   ```
   The link signs the MacBook in as the device the imported chats were placed on, so enrolling makes that device run agents. Settings, Devices then shows one MacBook, marked Runs agents. Its folders are checked when it connects: an agent's Setup tab, under Folders, shows them found.
4. **The dev setup** from the build (the worker in `~/ri-homes-connected`) can stop: `pnpm iso ~/ri-homes-connected -- pnpm -s cli:dev worker disable`.

## Checks when it's done

- The Mini's Ri shows the laptop's chats under their agents, read, and labeled MacBook.
- Settings, Devices lists the Mac Mini (Home), the MacBook (Runs agents) and the phone, each once.
- Continuing one runs on the MacBook, in its folder there, and the agent remembers the conversation (its native session is on the MacBook).
- `pnpm cli:dev start` in the MacBook's `~/ri` says its home was retired, and starts nothing.

## If something goes wrong

Each step says what to do. Nothing is deleted anywhere, so every way back is a copy or a move.

- **Before step 4 on the Mini:** restart with the old code: `git checkout <the commit before>`, `pnpm install && pnpm build`, `pnpm cli:dev start`. The database is untouched until step 4.
- **Step 4 fails:** nothing was imported (it's one transaction). Fix what it names and run it again. It skips anything already there.
- **After step 4, going back** means the backup from step 2. The old code refuses the upgraded database, saying "Database migration 3 does not match this release. No migration was applied", so a code revert alone never loses data, and never runs on it either (rehearsed). With Ri stopped:
  ```
  mkdir ~/ri/.rolled-back-$(date -u +%Y%m%dT%H%M%SZ)
  mv ~/ri/data.db* ~/ri/.config/machine.json ~/ri/.rolled-back-*/
  cp "$B/data.db" ~/ri/data.db
  git checkout <the commit before> && pnpm install && pnpm build && pnpm cli:dev start
  ```
  Only the database is swapped: `~/ri/.work` holds this home's worktrees, so the folder stays. What was written on the Mini after the switch (new chats, tasks, notes) is in the set-aside database, not the restored one.
- **The laptop, back to its own home:** in its `~/ri`, `pnpm cli:dev disconnect` if it connected, then `pnpm cli:dev home retire --undo`. On an older Ri that has no `home retire`, move `data.db` and `machine.json` from the newest `~/ri/.retired/<time>/` back to `~/ri/` and `~/ri/.config/`.

## What's kept, and where (P5.6)

| What | Where | Kept by |
| --- | --- | --- |
| The Mini's data before the switch | `~/ri-backups/ri-pre-homes-<time>` | the backup (step 2), verified |
| The laptop's data | `~/ri-backups/laptop-final-<time>` on both computers, and `~/ri/.retired/<time>/` on the MacBook | its backup, and retiring (moved, never deleted) |
| What came from the laptop, record by record | `~/ri/.archive/imports/<time>-<id>.json` on the Mini | the import's manifest |
| Worktrees and project folders | where they are on each computer | nothing moves them |
| Native transcripts (Claude Code, Codex) | `~/.claude`, `~/.codex` on each computer | nothing touches them |
| Unpublished code | in its folders, listed by `unpublished-work.ts` | nothing moves it |
| Attachments | `~/ri/attachments` on the Mini, the laptop's copied in | the import copies, never moves |

Not kept by a rollback: what's written on the Mini after the switch. It's in the set-aside database, readable, and its chats and work are still in their folders.
