/**
 * Decks for the dev seed: the last few days, each reconciled from the one
 * before, and today in two versions (the 5 AM morning deck, then a manual
 * regenerate after Maya said she had less time), so the deck view, its
 * "what changed" brief and its version history all have something real.
 * Seeding today's deck also means opening the dev home doesn't start an AI
 * generation.
 */

import type { DeckAlternative, DeckChange, DeckItem, CalendarBlock } from '../../src/lib/db/schema';
import { dateIn, daysAgo } from './time';

interface DeckCtx {
  q: typeof import('../../src/lib/db/queries');
  db: ReturnType<typeof import('../../src/lib/db').getDb>;
  schema: typeof import('../../src/lib/db/schema');
  eq: typeof import('drizzle-orm').eq;
  taskIds: Map<string, string>;
}

type ItemSpec = [title: string, rationale: string, continuity?: string];
type AltSpec = [title: string, reason: string];
type ChangeSpec = [kind: DeckChange['kind'], title: string, reason: string];

interface DeckSpec {
  day: number;
  createdAt: string;
  origin: 'morning' | 'first_open' | 'midday' | 'manual';
  framing: string;
  context?: string;
  items: ItemSpec[];
  alternatives: AltSpec[];
  changes: ChangeSpec[];
  calendar?: Array<[start: [number, number], end: [number, number], title: string]>;
  brief: string;
}

const specs: DeckSpec[] = [
  {
    day: -3,
    createdAt: daysAgo(3, 5, 0),
    origin: 'morning',
    framing: 'Roast day. Keep the morning for the roaster and batch the admin after lunch.',
    items: [
      ['Weekly roast schedule', 'Roast day starts with the schedule. Three wholesale orders are waiting on it.'],
      ['Wholesale order form: validate case quantities', 'Grain & Gather got through with half a case. Small fix, and the agent can do most of it.'],
      ['Chart roast curves from Artisan logs', 'You keep screenshotting Artisan. An agent can have a first chart by lunch.'],
      ['Organize 2026 tax documents', 'The inbox folder is growing. Thirty minutes now saves a bad week in March.'],
    ],
    alternatives: [['Fix the leaky skylight', 'Rain is not in the forecast until Friday.']],
    changes: [],
    brief: '**Context brief**\n\n- Roast day. Calendar shows the roaster booked 7:00 to 12:30.\n- Three wholesale orders depend on the roast schedule.\n- No hard deadlines today.',
  },
  {
    day: -2,
    createdAt: daysAgo(2, 5, 0),
    origin: 'morning',
    framing: 'One Fieldnote block for the landing page, then house calls.',
    items: [
      ['Launch landing page with waitlist', 'The waitlist should exist before TestFlight round 3 goes out.', 'Hero copy is settled from the onboarding screens.'],
      ['Wholesale order form: validate case quantities', 'The agent finished. Merge it so Little Owl can reorder.', 'Carried from yesterday.'],
      ['Call Dana about the panel upgrade', "Dana's quote is good for 30 days and two have passed since you got it."],
      ['Fix the leaky skylight', 'It has been pushed three times and rain is coming Friday.'],
    ],
    alternatives: [['Pick the kitchen backsplash tile', 'Samples arrive Thursday. Better to decide with them in hand.']],
    changes: [
      ['carried', 'Wholesale order form: validate case quantities', 'Waiting on your merge.'],
      ['dropped', 'Weekly roast schedule', 'Done for this week.'],
      ['added', 'Launch landing page with waitlist', 'Needed before the next TestFlight round.'],
    ],
    brief: '**Context brief**\n\n- Two Fieldnote items are in progress. The landing page is the one with a dependency (TestFlight round 3).\n- The skylight has been deferred three times.',
  },
  {
    day: -1,
    createdAt: daysAgo(1, 5, 0),
    origin: 'morning',
    framing: 'Mostly admin and one decision. Light day before the long run.',
    items: [
      ['Order green coffee for winter', 'Meridian needs the order by Thursday to hold the Guji lot.', 'Luis wants to agree on the Guji amount first.'],
      ['Call Dana about the panel upgrade', 'Still open, and the quote clock is running.', 'Carried from yesterday.'],
      ['Voice notes: transcribe on device', 'Good evening agent work. Start it before dinner and review in the morning.'],
      ['Organize 2026 tax documents', 'The agent can draft the checklist while you do the coffee order.'],
      ['Fix the leaky skylight', 'Fourth time on the deck. Book someone or drop it.'],
    ],
    alternatives: [
      ['Renew home insurance', 'Due in two weeks. Fine to leave until the quote comparison is in.'],
      ['Write the privacy policy', 'Needed before submission, but not before the sync fix.'],
    ],
    changes: [
      ['carried', 'Call Dana about the panel upgrade', 'Not done yesterday.'],
      ['carried', 'Fix the leaky skylight', 'Not done yesterday.'],
      ['dropped', 'Wholesale order form: validate case quantities', 'Merged and done.'],
      ['added', 'Order green coffee for winter', 'Deadline is in four days.'],
    ],
    brief: '**Context brief**\n\n- Hard deadline in 4 days: green coffee order.\n- The skylight has rolled over four times. Suggest a decision.',
  },
  {
    day: 0,
    createdAt: daysAgo(0, 5, 0),
    origin: 'morning',
    framing: 'Long run first, then the two overdue calls, then Fieldnote review. Hard stop for piano pickup at 3:30.',
    items: [
      ['Long run: 18 miles', 'It is due today and it gets hot after noon. Go before 8.'],
      ['Book physio for calf strain', 'It was due yesterday, and the calf decides whether week 13 happens.'],
      ["Ruby's field trip permission slip", 'Due tomorrow. Sign it tonight with the backpack check.'],
      ['Call Dana about the panel upgrade', 'Her quote expires Thursday. Third day on the deck.', 'Carried from yesterday.'],
      ['Order green coffee for winter', 'Due in 3 days. Settle the Guji amount with Luis at the cupping.', 'Carried from yesterday.'],
      ['Fix offline sync dropping sightings', 'The agent finished overnight. Review the two commits and push so testers stop losing sightings.'],
      ['Hire a part-time production roaster', 'Two phone screens left. The questions are on the task.'],
    ],
    alternatives: [
      ['Pick the kitchen backsplash tile', 'Theo wants to see samples in person first.'],
      ['Renew home insurance', 'Twelve days left. It fits on a lighter day.'],
      ['Subscription: let customers skip a month', 'The agent hit a setup error. Retry when you have five minutes.'],
    ],
    changes: [
      ['carried', 'Call Dana about the panel upgrade', 'Still open, and the quote expires Thursday.'],
      ['carried', 'Order green coffee for winter', 'Deadline is close.'],
      ['deferred', 'Fix the leaky skylight', 'No rain until the weekend. Deferred again.'],
      ['deferred', 'Organize 2026 tax documents', 'The agent made the checklist. Nothing more is due this week.'],
      ['added', 'Long run: 18 miles', 'Scheduled for today in the training plan.'],
      ['added', 'Fix offline sync dropping sightings', 'Agent work is ready for review.'],
    ],
    calendar: [[[10, 0], [11, 0], 'Cupping with Luis (Guji lots)'], [[15, 30], [16, 0], 'Ruby piano pickup']],
    brief: '**Context brief**\n\n- Hard deadlines: the long run is today, the physio booking was due yesterday, the permission slip is due tomorrow.\n- Calendar: cupping with Luis 10:00 to 11:00, piano pickup 15:30.\n- Agent work ready: the sync fix (needs review), voice notes (needs a decision).',
  },
  {
    day: 0,
    createdAt: daysAgo(0, 9, 40),
    origin: 'manual',
    context: 'Less time than planned, maybe 3 hours of desk time after the run.',
    framing: 'Three hours of desk time: the calls and the review. The roaster screens move to tomorrow.',
    items: [
      ['Long run: 18 miles', 'Done this morning or still to do, it stays first.'],
      ['Book physio for calf strain', 'Two minutes and it was due yesterday.'],
      ['Call Dana about the panel upgrade', 'Quote expires Thursday.', 'Carried from yesterday.'],
      ['Order green coffee for winter', 'Settle it at the cupping at 10.', 'Carried from yesterday.'],
      ['Fix offline sync dropping sightings', 'Review and push. The agent did the work.'],
      ["Ruby's field trip permission slip", 'Sign it tonight.'],
    ],
    alternatives: [
      ['Hire a part-time production roaster', 'Moved to tomorrow: you said you have about 3 hours.'],
      ['Pick the kitchen backsplash tile', 'Waiting on samples.'],
    ],
    changes: [
      ['bumped', 'Hire a part-time production roaster', 'You have about 3 hours today.'],
      ['reordered', 'Fix offline sync dropping sightings', 'Moved after the calls.'],
    ],
    calendar: [[[10, 0], [11, 0], 'Cupping with Luis (Guji lots)'], [[15, 30], [16, 0], 'Ruby piano pickup']],
    brief: '**Context brief**\n\n- The user has about 3 hours of desk time after the run.\n- Keep everything with a deadline. Move the phone screens.',
  },
];

export function seedDecks(ctx: DeckCtx): number {
  const { q, db, schema, eq, taskIds } = ctx;
  const id = (title: string) => {
    const v = taskIds.get(title);
    if (!v) throw new Error(`deck: no task "${title}"`);
    return v;
  };
  let previous: { forDate: string; id: string } | null = null;
  for (const spec of specs) {
    const forDate = dateIn(spec.day);
    const calendarSnapshot: CalendarBlock[] = (spec.calendar ?? []).map(([[sh, sm], [eh, em], title]) => {
      const start = new Date(); start.setDate(start.getDate() + spec.day); start.setHours(sh, sm, 0, 0);
      const end = new Date(start); end.setHours(eh, em, 0, 0);
      return { start: start.toISOString(), end: end.toISOString(), title, source: 'google' };
    });
    const deck = q.supersedeAndInsertDeck({
      forDate,
      origin: spec.origin,
      framing: spec.framing,
      context: spec.context ?? null,
      contextTags: [],
      model: 'claude/opus',
      items: spec.items.map(([title, rationale, continuity]): DeckItem => ({ taskId: id(title), rationale, continuityContext: continuity ?? null, source: 'ai' })),
      alternatives: spec.alternatives.map(([title, reason]): DeckAlternative => ({ taskId: id(title), reason })),
      changes: spec.changes.map(([kind, title, reason]): DeckChange => ({ kind, taskId: id(title), title, reason, source: 'reconcile', channel: 'digest' })),
      calendarSnapshot,
      searchContext: spec.brief,
    });
    db.update(schema.decks).set({ createdAt: spec.createdAt, updatedAt: spec.createdAt }).where(eq(schema.decks.id, deck.id)).run();
    // A same-day regenerate supersedes the earlier version at the time it ran.
    if (previous && previous.forDate === forDate) {
      db.update(schema.decks).set({ supersededAt: spec.createdAt, updatedAt: spec.createdAt }).where(eq(schema.decks.id, previous.id)).run();
    }
    previous = { forDate, id: deck.id };
  }
  return specs.length;
}
