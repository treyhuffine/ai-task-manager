/**
 * Tasks for the shared dev seed. Reference an area by `area_name`; the
 * runner resolves it to `areaId` after areas are created. Reference a
 * parent task by `parent_title` for subtasks; the runner resolves it to
 * `parentId` against earlier-created tasks (parents must appear first).
 *
 * Title is the stable reference key — notes.ts can attach a note to a
 * task by `task_title`. Titles must be unique across this file.
 *
 * The set below demonstrates the model: a "project" is a top-level task
 * with subtasks (Kitchen renovation, Summer trip, Area refactor) — no
 * separate Project primitive needed. Simple tasks are just tasks. Order
 * matters: parents come before their children.
 */
import type { CreateTaskInput } from '../../src/db/types';

export type SeedTask = Omit<CreateTaskInput, 'areaId' | 'rawInput' | 'parentId'> & {
  area_name?: string;
  parent_title?: string;
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
    status: 'active',
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
    status: 'active',
  },
  {
    title: 'Write 30-second quickstart',
    area_name: 'AI Assistant',
    parent_title: 'Ship V1 alpha to friends',
    description: 'One screen. Three steps. No video.',
    energy: 'light',
    effort: 'small',
    status: 'active',
  },
  {
    title: 'Fix top 3 self-dogfooding bugs',
    area_name: 'AI Assistant',
    parent_title: 'Ship V1 alpha to friends',
    description: 'See the open-issues note. Pick the 3 most painful.',
    energy: 'deep',
    effort: 'medium',
    status: 'active',
  },
  {
    title: 'Send invites to 10 trusted friends',
    area_name: 'AI Assistant',
    parent_title: 'Ship V1 alpha to friends',
    energy: 'light',
    effort: 'trivial',
    status: 'active',
  },
  {
    title: 'Decide on V1 launch criteria',
    area_name: 'AI Assistant',
    description: 'What does "done enough to share" look like? Define the bar.',
    energy: 'deep',
    effort: 'medium',
    status: 'active',
  },
  {
    title: 'Wire up keyboard shortcuts (capture, search, focus)',
    area_name: 'AI Assistant',
    description:
      'cmd-k for capture, cmd-/ for search, cmd-. for focus mode. Match the ' +
      'shortcuts most people already have muscle memory for.',
    energy: 'light',
    effort: 'small',
    status: 'active',
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
    status: 'active',
  },

  // ─── Health ─────────────────────────────────────────────────────
  {
    title: 'Annual physical',
    area_name: 'Health',
    description: 'Schedule and attend. Last visit was a year ago this month.',
    hardDeadline: '2026-06-15',
    energy: 'light',
    effort: 'small',
    status: 'active',
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
    status: 'active',
    heartbeatDays: 1,
  },
  {
    title: 'Order new running shoes',
    area_name: 'Health',
    energy: 'light',
    effort: 'trivial',
    status: 'active',
  },

  // ─── Family ─────────────────────────────────────────────────────
  {
    title: 'Plan summer trip with kids',
    area_name: 'Family',
    description: 'Pick destination, dates, lodging. Aim for 8 days late July.',
    outcome: 'Trip booked with confirmations in calendar.',
    energy: 'deep',
    effort: 'large',
    status: 'active',
  },
  {
    title: 'Pick destination (3 options to compare)',
    area_name: 'Family',
    parent_title: 'Plan summer trip with kids',
    description: 'Coastal vs mountains vs cities. Kid-friendly, <6h flight.',
    energy: 'light',
    effort: 'small',
    status: 'active',
  },
  {
    title: 'Lock dates with both work calendars',
    area_name: 'Family',
    parent_title: 'Plan summer trip with kids',
    energy: 'light',
    effort: 'trivial',
    status: 'active',
  },
  {
    title: 'Book flights and lodging',
    area_name: 'Family',
    parent_title: 'Plan summer trip with kids',
    energy: 'light',
    effort: 'small',
    status: 'active',
  },
  {
    title: 'Schedule dinner with parents',
    area_name: 'Family',
    description: 'Aim for second weekend in May.',
    energy: 'light',
    effort: 'trivial',
    status: 'active',
  },
  {
    title: 'Sign Sammy up for fall soccer',
    area_name: 'Family',
    description: 'Registration opens May 1. League website link in note.',
    hardDeadline: '2026-05-15',
    energy: 'light',
    effort: 'small',
    status: 'active',
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
    status: 'active',
  },
  {
    title: 'Get 3 contractor quotes',
    area_name: 'Home',
    parent_title: 'Kitchen renovation',
    description: 'Reach out to Mike (referred), one Yelp top-rated, one Houzz.',
    energy: 'light',
    effort: 'small',
    status: 'active',
  },
  {
    title: 'Choose appliances (range, fridge, dishwasher)',
    area_name: 'Home',
    parent_title: 'Kitchen renovation',
    energy: 'deep',
    effort: 'medium',
    status: 'active',
  },
  {
    title: 'Pick countertop material',
    area_name: 'Home',
    parent_title: 'Kitchen renovation',
    description: 'Quartz vs marble vs butcher block. Cost vs maintenance.',
    energy: 'light',
    effort: 'small',
    status: 'active',
  },
  {
    title: 'Schedule demo week',
    area_name: 'Home',
    parent_title: 'Kitchen renovation',
    energy: 'light',
    effort: 'trivial',
    status: 'active',
    blockedOn: 'Choosing contractor',
  },
  {
    title: 'Replace water filter',
    area_name: 'Home',
    description: 'Under-sink filter, every 6 months. Last replaced Nov 2025.',
    energy: 'light',
    effort: 'trivial',
    status: 'active',
    recurrence: '180d',
  },

  // ─── Finance ────────────────────────────────────────────────────
  {
    title: 'File Q2 estimated taxes',
    area_name: 'Finance',
    hardDeadline: '2026-06-15',
    energy: 'light',
    effort: 'small',
    status: 'active',
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
    status: 'active',
  },
  {
    title: 'Audit recurring subscriptions',
    area_name: 'Finance',
    description: 'Pull statements, kill anything unused for 60+ days.',
    energy: 'light',
    effort: 'small',
    status: 'active',
  },

  // ─── Reading ────────────────────────────────────────────────────
  {
    title: 'Antifragile — Taleb',
    area_name: 'Reading',
    description: 'Re-read for the second time. Take chapter notes this round.',
    energy: 'light',
    effort: 'medium',
    status: 'active',
    lastProgressAt: '2026-04-21T20:30:00Z',
  },
  {
    title: 'Crossroads — Franzen',
    area_name: 'Reading',
    description: 'Long literary novel. Bedtime reading, no rush.',
    energy: 'light',
    effort: 'medium',
    status: 'active',
  },
  {
    title: 'Designing Data-Intensive Applications — Kleppmann',
    area_name: 'Reading',
    description: 'Slow read, chapter-per-week. Take detailed notes per chapter.',
    energy: 'deep',
    effort: 'large',
    status: 'active',
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
    status: 'active',
  },
  {
    title: 'Publish post: building the AI assistant',
    area_name: 'Writing',
    description: 'Behind-the-scenes on the area-model decision.',
    energy: 'light',
    effort: 'small',
    status: 'active',
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
    status: 'active',
  },
  {
    title: 'Quarterly coffee — old colleague',
    area_name: 'Network',
    description: 'Last met February. Schedule for late May.',
    energy: 'light',
    effort: 'trivial',
    status: 'active',
    recurrence: '90d',
  },

  // ─── Hobbies ────────────────────────────────────────────────────
  {
    title: 'Buy new chess board',
    area_name: 'Hobbies',
    description: 'Tournament size, weighted pieces. Replace the small travel one.',
    energy: 'light',
    effort: 'trivial',
    status: 'active',
  },
];
