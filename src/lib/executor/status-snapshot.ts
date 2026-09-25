/**
 * Lightweight, read-only snapshot of live session state: which sessions have
 * a turn in flight, which have background tasks, and which have a pending
 * input request (permission / AskUserQuestion) blocking the agent.
 *
 * Why this exists — compile cost, not runtime: the rail and other status
 * endpoints shouldn't pull in the agent engine just to read in-memory
 * collections. Turbopack dev is very slow to compile that graph (seconds per
 * route; `/api/sessions/rail` never finished). The live-state facade and the
 * runner's state and prompt store import nothing heavy, so this reads them
 * directly.
 */

export {
  listRunningSessions,
  listBackgroundTaskSessions,
  listSessionsWithPending,
} from './live-state';
