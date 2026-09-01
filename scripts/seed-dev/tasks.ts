/**
 * Tasks for the shared dev seed. Reference an area by `area_name`; the
 * runner resolves it to `areaId` after areas are created. Reference a
 * parent task by `parent_title` for subtasks; the runner resolves it to
 * `parentId` against earlier-created tasks (parents must appear first).
 * Reference a blocking task by `blocked_on_title`; the runner resolves it
 * to `blockedOn` (the blocker's id), so the blocker must also appear first.
 *
 * Title is the stable reference key — notes.ts can attach a note to a
 * task by `task_title`. Titles must be unique across this file.
 *
 * The set below demonstrates the model: a "project" is a top-level task
 * with subtasks (Kitchen renovation, Summer trip, Area refactor) — no
 * separate Project primitive needed. Simple tasks are just tasks. Order
 * matters: parents (and blockers) come before their children.
 *
 * Lifecycle status is one of consider | todo | in_progress | done |
 * archived (see src/lib/tasks/lifecycle.ts). The seed spreads across all
 * five: most work is `todo` (committed queue), a few open decisions are
 * `consider`, a couple are `in_progress` (one of them blocked), two are
 * `done`, one is `archived`, and two recurring tasks stay `todo` with a
 * `nextRecurrenceAt`. `statusChangedCount` is a small positive integer on
 * rows that moved through states, and `statusChangedAt` records when a
 * task entered its current status (createTask also stamps it at creation).
 */
import type { CreateTaskInput } from '../../src/db/types';

export type SeedTask = Omit<CreateTaskInput, 'areaId' | 'rawInput' | 'parentId'> & {
  area_name?: string;
  parent_title?: string;
  /** Title of an earlier-seeded task this one is blocked on. Resolved to
   *  `blockedOn` (the blocker's id) by the runner. */
  blocked_on_title?: string;
  rawInput?: string;
};

export const tasks: SeedTask[] = [
  // ─── AI Assistant ───────────────────────────────────────────────
  {
    title: 'Ship V1 alpha to friends',
    area_name: 'AI Assistant',
    description:
      'Get the app in front of ~10 trusted users for two weeks of feedback. ' +
      'Not public, not polished — just usable end-to-end.',
    outcome: '10 users have tried it; written feedback collected from each.',
    energy: 'deep',
    effort: 'large',
    status: 'todo',
  },
  {
    title: 'Lock V1 scope (cut half the backlog)',
    area_name: 'AI Assistant',
    parent_title: 'Ship V1 alpha to friends',
    description:
      'Anything outside capture / organize / find / chat is out for V1. ' +
      'Move the rest to a "later" note.',
    energy: 'deep',
    effort: 'small',
    status: 'done',
    completedAt: '2026-04-18T22:10:00Z',
    statusChangedAt: '2026-04-18T22:10:00Z',
    statusChangedCount: 2,
  },
  {
    title: 'Write 30-second quickstart',
    area_name: 'AI Assistant',
    parent_title: 'Ship V1 alpha to friends',
    description: 'One screen. Three steps. No video.',
    energy: 'light',
    effort: 'small',
    status: 'todo',
  },
  {
    title: 'Fix top 3 self-dogfooding bugs',
    area_name: 'AI Assistant',
    parent_title: 'Ship V1 alpha to friends',
    description: 'See the open-issues note. Pick the 3 most painful.',
    energy: 'deep',
    effort: 'medium',
    status: 'in_progress',
    statusChangedAt: '2026-04-24T15:30:00Z',
    statusChangedCount: 1,
  },
  {
    title: 'Send invites to 10 trusted friends',
    area_name: 'AI Assistant',
    parent_title: 'Ship V1 alpha to friends',
    energy: 'light',
    effort: 'trivial',
    status: 'todo',
  },
  {
    title: 'Decide on V1 launch criteria',
    area_name: 'AI Assistant',
    description: 'What does "done enough to share" look like? Define the bar.',
    energy: 'deep',
    effort: 'medium',
    status: 'consider',
  },
  {
    title: 'Wire up keyboard shortcuts (capture, search, focus)',
    area_name: 'AI Assistant',
    description:
      'cmd-k for capture, cmd-/ for search, cmd-. for focus mode. Match the ' +
      'shortcuts most people already have muscle memory for.',
    energy: 'light',
    effort: 'small',
    status: 'todo',
  },
  {
    title: 'Onboarding flow — second pass',
    area_name: 'AI Assistant',
    description:
      'Current onboarding asks too many questions before showing value. ' +
      'Swap the order: show the dashboard with sample data first, ' +
      'collect preferences after.',
    energy: 'deep',
    effort: 'medium',
    status: 'consider',
  },
  {
    title: 'Prototype a Kanban board view',
    area_name: 'AI Assistant',
    description:
      'Explored a drag-and-drop board. Cut it because it adds the human-org ' +
      'structure the model is meant to remove. Keeping the note as a record.',
    energy: 'deep',
    effort: 'medium',
    status: 'archived',
    statusChangedAt: '2026-04-08T17:00:00Z',
    statusChangedCount: 1,
  },

  // ─── Health ─────────────────────────────────────────────────────
  {
    title: 'Annual physical',
    area_name: 'Health',
    description: 'Schedule and attend. Last visit was a year ago this month.',
    hardDeadline: '2026-06-15',
    energy: 'light',
    effort: 'small',
    status: 'todo',
  },
  {
    title: 'Sleep stack experiment: blue blockers + 18C',
    area_name: 'Health',
    description:
      'Wear blue-blockers from 8pm. Drop bedroom to 18C. Track sleep score ' +
      'and morning HRV for 14 days. Compare against baseline.',
    outcome: 'Verdict on whether blue blockers + cooler room move the needle.',
    energy: 'light',
    effort: 'small',
    status: 'in_progress',
    statusChangedAt: '2026-04-23T07:00:00Z',
    statusChangedCount: 1,
    heartbeatDays: 1,
  },
  {
    title: 'Order new running shoes',
    area_name: 'Health',
    energy: 'light',
    effort: 'trivial',
    status: 'todo',
  },

  // ─── Family ─────────────────────────────────────────────────────
  {
    title: 'Plan summer trip with kids',
    area_name: 'Family',
    description: 'Pick destination, dates, lodging. Aim for 8 days late July.',
    outcome: 'Trip booked with confirmations in calendar.',
    energy: 'deep',
    effort: 'large',
    status: 'todo',
  },
  {
    title: 'Pick destination (3 options to compare)',
    area_name: 'Family',
    parent_title: 'Plan summer trip with kids',
    description: 'Coastal vs mountains vs cities. Kid-friendly, <6h flight.',
    energy: 'light',
    effort: 'small',
    status: 'done',
    completedAt: '2026-04-15T19:00:00Z',
    statusChangedAt: '2026-04-15T19:00:00Z',
    statusChangedCount: 2,
  },
  {
    title: 'Lock dates with both work calendars',
    area_name: 'Family',
    parent_title: 'Plan summer trip with kids',
    energy: 'light',
    effort: 'trivial',
    status: 'todo',
  },
  {
    title: 'Book flights and lodging',
    area_name: 'Family',
    parent_title: 'Plan summer trip with kids',
    description: 'Started comparing fares. Holding until the dates are locked.',
    energy: 'light',
    effort: 'small',
    status: 'in_progress',
    statusChangedAt: '2026-04-26T16:00:00Z',
    statusChangedCount: 1,
    blocked_on_title: 'Lock dates with both work calendars',
    blockedSince: '2026-04-26T16:05:00Z',
  },
  {
    title: 'Schedule dinner with parents',
    area_name: 'Family',
    description: 'Aim for second weekend in May.',
    energy: 'light',
    effort: 'trivial',
    status: 'todo',
  },
  {
    title: 'Sign Sammy up for fall soccer',
    area_name: 'Family',
    description: 'Registration opens May 1. League website link in note.',
    hardDeadline: '2026-05-15',
    energy: 'light',
    effort: 'small',
    status: 'todo',
  },

  // ─── Home ───────────────────────────────────────────────────────
  {
    title: 'Kitchen renovation',
    area_name: 'Home',
    description:
      'Full kitchen renovation: new cabinets, countertops, appliances, ' +
      'flooring. Budget around $40k. Demo target: late June.',
    outcome: 'Functioning new kitchen passing inspection.',
    energy: 'deep',
    effort: 'epic',
    status: 'todo',
  },
  {
    title: 'Get 3 contractor quotes',
    area_name: 'Home',
    parent_title: 'Kitchen renovation',
    description: 'Reach out to Mike (referred), one Yelp top-rated, one Houzz.',
    energy: 'light',
    effort: 'small',
    status: 'todo',
  },
  {
    title: 'Choose appliances (range, fridge, dishwasher)',
    area_name: 'Home',
    parent_title: 'Kitchen renovation',
    energy: 'deep',
    effort: 'medium',
    status: 'todo',
  },
  {
    title: 'Pick countertop material',
    area_name: 'Home',
    parent_title: 'Kitchen renovation',
    description: 'Quartz vs marble vs butcher block. Cost vs maintenance.',
    energy: 'light',
    effort: 'small',
    status: 'consider',
  },
  {
    title: 'Schedule demo week',
    area_name: 'Home',
    parent_title: 'Kitchen renovation',
    energy: 'light',
    effort: 'trivial',
    status: 'todo',
    blocked_on_title: 'Get 3 contractor quotes',
    blockedSince: '2026-04-22T14:00:00Z',
  },
  {
    title: 'Replace water filter',
    area_name: 'Home',
    description: 'Under-sink filter, every 6 months. Last replaced Nov 2025.',
    energy: 'light',
    effort: 'trivial',
    status: 'todo',
    recurrence: '180d',
    nextRecurrenceAt: '2026-05-20T09:00:00Z',
  },

  // ─── Finance ────────────────────────────────────────────────────
  {
    title: 'File Q2 estimated taxes',
    area_name: 'Finance',
    hardDeadline: '2026-06-15',
    energy: 'light',
    effort: 'small',
    status: 'todo',
  },
  {
    title: 'Annual insurance review',
    area_name: 'Finance',
    description:
      'Review home, auto, umbrella, life. Compare against current rates and ' +
      'shop one alternative quote per policy.',
    outcome: 'Coverage confirmed adequate; switching where it saves >15%.',
    energy: 'deep',
    effort: 'medium',
    status: 'todo',
  },
  {
    title: 'Audit recurring subscriptions',
    area_name: 'Finance',
    description: 'Pull statements, kill anything unused for 60+ days.',
    energy: 'light',
    effort: 'small',
    status: 'todo',
  },

  // ─── Reading ────────────────────────────────────────────────────
  {
    title: 'Antifragile — Taleb',
    area_name: 'Reading',
    description: 'Re-read for the second time. Take chapter notes this round.',
    energy: 'light',
    effort: 'medium',
    status: 'todo',
    lastProgressAt: '2026-04-21T20:30:00Z',
  },
  {
    title: 'Crossroads — Franzen',
    area_name: 'Reading',
    description: 'Long literary novel. Bedtime reading, no rush.',
    energy: 'light',
    effort: 'medium',
    status: 'todo',
  },
  {
    title: 'Designing Data-Intensive Applications — Kleppmann',
    area_name: 'Reading',
    description: 'Slow read, chapter-per-week. Take detailed notes per chapter.',
    energy: 'deep',
    effort: 'large',
    status: 'todo',
  },

  // ─── Writing ────────────────────────────────────────────────────
  {
    title: 'Draft essay: simple systems compound',
    area_name: 'Writing',
    description:
      'Argument: simple systems beat complex ones over long horizons because ' +
      'they tolerate maintenance lapses. Use the productivity-tool example.',
    energy: 'deep',
    effort: 'medium',
    status: 'todo',
  },
  {
    title: 'Publish post: building the AI assistant',
    area_name: 'Writing',
    description: 'Behind-the-scenes on the area-model decision.',
    energy: 'light',
    effort: 'small',
    status: 'todo',
  },

  // ─── Network ────────────────────────────────────────────────────
  {
    title: 'Send one-pager for investor intro',
    area_name: 'Network',
    description:
      'Friend at a venture firm offered the intro last month — she just ' +
      'needs a one-pager first. Cleanest version yet exists in Writing.',
    energy: 'light',
    effort: 'trivial',
    status: 'todo',
  },
  {
    title: 'Quarterly coffee — old colleague',
    area_name: 'Network',
    description: 'Last met February. Schedule for late May.',
    energy: 'light',
    effort: 'trivial',
    status: 'todo',
    recurrence: '90d',
    nextRecurrenceAt: '2026-05-10T18:00:00Z',
  },

  // ─── Hobbies ────────────────────────────────────────────────────
  {
    title: 'Buy new chess board',
    area_name: 'Hobbies',
    description: 'Tournament size, weighted pieces. Replace the small travel one.',
    energy: 'light',
    effort: 'trivial',
    status: 'todo',
  },
];
