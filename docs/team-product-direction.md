# Team/Enterprise Product Direction

> Operational build plan. The full reasoning, paths considered, and zoomed-out framework live in `philosophy-and-vision.md`.

## Model
- **Personal instance** = your AI assistant. Where you live and execute. Pulls in only YOUR tasks from connected sources.
- **Team instance** = one per company/org. Same codebase, deployed in "team mode." Holds shared state — all tasks, all people, projects, assignment.
- **Same repo, same product, deployment flag** (`MODE=personal` vs `MODE=team`). Team features are additive routes/components, not a fork.

## How it works
- Personal instance connects to team instances (and external tools like Linear/Asana) as "sources"
- Team server scopes by identity — your token means you only pull tasks assigned to you
- Synced tasks become local copies linked by `source` + `external_id`
- Shared fields sync bidirectionally (status, completion, title). Personal enrichment stays local (energy, effort, subtasks, AI context, sort order, area)
- Same adapter pattern for team instances and third-party integrations

## UX
- Workspace switcher (like Slack). Personal is home/default, team workspaces one click away.
- Personal view = your queue across all sources, AI prioritizes everything together
- Team view = shared board, assignment, capacity — different UI surface, same app

## Agent model
- Personal agents stay personal. Your AI, your context, your flow.
- Shared agent context as a later evolution — agents can read team state to avoid duplication and coordinate implicitly
- Team-level AI agent for coordination/routing is a future add, not required at launch

## What's needed when we build it
1. Add `source` and `external_id` columns to tasks (one migration)
2. Add `sync_connections` table for team/integration configs
3. Team-only schema additions: users, memberships, assignment
4. Team-only routes: `/api/team/*`, sync API
5. Sync polling or webhook subscription logic
6. Workspace switcher UI

## Key decision: build after MVP
Current architecture is sound — UUIDv7 IDs won't collide across instances, Drizzle query layer is cleanly separated, personal-first design means team is an expansion pack not a rewrite. No premature multi-tenancy needed. One design constraint to hold: when building features, ask "does this still work if the task came from somewhere else?"
