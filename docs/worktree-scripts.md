# Worktree scripts

Each agent execution runs in its own git worktree — a fresh checkout on its own
branch. A fresh worktree has **no installed dependencies** and **none of your
gitignored files** (`.env`, build caches, `node_modules`). Worktree scripts are
how you provision it.

They're configured per workspace (workspace settings → **Worktree scripts**, or
on the create modal) and stored on the workspace row. All three are optional.
Flow stays strategy-agnostic: it runs your command and gets out of the way — the
project decides what setup means.

| Script | When it runs | Fatal? |
| --- | --- | --- |
| **Setup** | once, right after the worktree is created (and on resume) | Yes — a failed setup is recorded as the execution's setup error, with a retry. An unprovisioned worktree would fail downstream anyway. |
| **Start** | on demand, to start the dev server Flow supervises for previews | n/a — Flow assigns a stable `PORT` and waits for it to listen |
| **Teardown** | on archive, before the worktree is removed | No — best-effort; a failure won't block archiving |

Each runs as `sh -lc "<command>"` with the worktree as the working directory.

## Environment

| Variable | Meaning |
| --- | --- |
| `$FLOW_SOURCE_CHECKOUT_PATH` | the original repo checkout the worktree branched from |
| `$FLOW_WORKTREE_PATH` | the worktree directory (also the cwd) |
| `$FLOW_BRANCH_NAME` | the worktree's branch (setup only) |
| `$PORT` | the stable port assigned to the **start** command |

## Dependencies — getting it fast *and* correct

The tempting move — symlinking `node_modules` back to the source — is a trap: the
moment an agent's branch adds or bumps a dependency, an install either fails or
**mutates your real checkout** (and every other worktree pointing at it). Give
each worktree its own writable tree instead. Pick by package manager / OS:

**pnpm / yarn Berry** — the package manager already hardlinks from a global
content-addressed store, so a per-worktree install is fast *and* isolated:

```sh
# Setup
pnpm install        # or: yarn install
```

**npm / yarn classic on macOS (APFS)** — a from-scratch install of a large
`node_modules` is slow. Clone it copy-on-write (instant, shares disk blocks until
modified, each worktree fully isolated), then reconcile any lockfile delta:

```sh
# Setup
cp -cR "$FLOW_SOURCE_CHECKOUT_PATH/node_modules" ./node_modules 2>/dev/null || true
yarn install --prefer-offline      # no-op if unchanged; adds only the delta
```

On Linux with a reflink-capable FS (btrfs/xfs), use `cp --reflink=auto -R` for the
same effect.

**Anything else** — just run the real install:

```sh
# Setup
npm ci
```

Because each worktree owns a real, writable tree, **new dependencies just work** —
the agent runs `yarn add foo`, it writes into that worktree, and the lockfile
change rides along in the branch diff. Setup can do more than deps, too — copy a
cache, run `db:migrate`, generate code: it's a shell script.
