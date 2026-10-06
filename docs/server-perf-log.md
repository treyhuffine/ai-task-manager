# Server perf log

The server runs on one thread, and better-sqlite3 runs every statement synchronously on it. A slow query, or any long stretch of synchronous work, holds every other request until it returns (AGENTS.md, "Query cost"). The perf log records enough to name the cause afterwards. Before it, a stall could only be guessed at: the server logs to a terminal and kept nothing.

Code: `src/lib/perf/` (`recorder.ts`, `sqlite.ts`, `labels.ts`, `summary.ts`). Reader: `ri perf` (`src/cli/commands/perf.ts`).

## Reading it

```
ri perf                  # the last 24 hours of the prod home
ri perf --since 30m      # 30m, 24h, 7d
ri perf --dev            # the dev home
ri perf --json           # the summary as JSON
```

It prints four things:

- **Stalls:** each time the thread was blocked 200 ms or more, longest first. If the database took most of a stall, it names the scope whose statements ran and the slowest SQL. Otherwise it says the database wasn't the cause and lists what was in flight.
- **Slow statements:** every statement of 100 ms or more, grouped by query shape. An `IN` list of any length counts as one shape. Each group shows its count, total time, longest run, and the scopes that ran it.
- **Most called:** each scope's calls, calls per minute, average and longest time, and database time. This is the request rate per procedure, for example how often an idle tab polls.
- **Most database time:** where the database's time went, including work outside any request.

## What it records

The log is `<work>/perf.jsonl`. At 8 MiB it rotates into `perf.1.jsonl`, keeping one previous file, which comes to about a week at normal load. It's machine-local like the rest of `.work`. Each line is a JSON record with `t` and `type`:

| type | when | carries |
|---|---|---|
| `start` | the server starts recording | pid, thresholds |
| `slow` | a statement takes 100 ms or more | `ms`, `label`, `sql` (never its parameters, and a select's long column list folded to `…` so the FROM and WHERE fit), `rows` for `all` |
| `stall` | a 100 ms timer fires 200 ms or more late | `ms`, the database time and statements by scope in that window, the three slowest statements, the scopes in flight |
| `rollup` | every minute | per scope: `n`, `ms`, `maxMs`, `dbMs`, `dbN`, plus event-loop delay `p50Ms`/`p99Ms`/`maxMs` and the minute's stalls |

Every statement is timed. `sqlite.ts` patches better-sqlite3's shared Statement prototype (`run`, `get`, `all`, `iterate`) and `Database#exec` once per process. That covers Drizzle, raw `prepare`, pragmas and transaction commits on every connection, at the cost of two `performance.now()` calls per statement.

## Scopes

A scope is a label for a unit of work. Scopes ride AsyncLocalStorage, so each statement is attributed to the innermost scope around it.

| label | opened by |
|---|---|
| `http:<METHOD> <route>` | `src/service/http-server.ts`, for every request. Record ids fold to `:id`. A request ends when its response finishes. A live stream (SSE) ends when its headers go out. |
| `trpc:<procedure>` | the HTTP host for `/api/trpc/<procedure>`, and the viewer middleware (`src/lib/trpc/init.ts`) for WebSocket calls. Both use the same label, so a call counts once whichever transport carried it. |
| `action:<name>` | `runAction` (`src/lib/orchestrator/dispatch.ts`), inside the MCP or actions request that carried it. |
| `ingest:<harness>` | `persistStreamEvent`, once per agent event stored. Shows how much time goes to taking in agent output. |
| `timer:scheduler`, `timer:mirror`, `timer:health`, `timer:notifier`, `startup:reconcile` | the background jobs. |

Two labels are derived:

- **`<label> (after)`** is work a scope started that outlived it. For example, a `sessions.send` request answers while the run it started keeps working.
- **`(none)`** is work in no scope. A lot of `(none)` time is the cue to label the job doing it: wrap its entry point in `perfScope('timer:<name>', () => ...)`.

Nested scopes are each counted under their own label. So an MCP request's time appears under its `http:` label and again under the `action:` labels inside it.

## Limits

- A stall that isn't the database (JSON on a huge response, a dev compile, garbage collection) is detected and timed, and lists what was in flight. It can't name the function. Use a CPU profile (`node --cpu-prof`) for that.
- Only the server records. A CLI command that opens the database records nothing, and neither does a validating update server.
- The thresholds (100 ms per statement, 200 ms per stall) are constants in `recorder.ts`.
