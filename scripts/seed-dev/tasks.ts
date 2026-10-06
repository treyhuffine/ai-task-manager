/**
 * Tasks for the shared dev seed. Reference an area by `area_name`. The runner
 * resolves it to `areaId` after areas are created. Reference a parent task by
 * `parent_title` for subtasks, resolved to `parentId` against earlier-created
 * tasks (parents must appear first). Reference a blocking task by
 * `blocked_on_title`, resolved to `blockedOn` (the blocker's id), so the
 * blocker must also appear first. `agent_slug` attaches a task to one of the
 * seeded agents, resolved by the runner.
 *
 * Title is the stable reference key. notes.ts attaches notes by `task_title`,
 * stream.ts points promoted captures at tasks by title, and bodies link to
 * each other with `{{task:Title}}` / `{{note:Title}}` markers that the runner
 * swaps for real link markers. Titles must be unique across this file.
 *
 * The world is Maya Okafor's (see areas.ts). The set shows the model:
 *  - A "project" is a top-level task with subtasks (Fieldnote 1.0 launch,
 *    Hire a part-time production roaster, Packaging redesign, Twin Rivers
 *    Marathon race prep, Ruby's 8th birthday party). No Project primitive.
 *  - Every lifecycle status (consider | todo | in_progress | done | archived,
 *    see src/lib/tasks/lifecycle.ts) with a realistic spread: a committed todo
 *    queue, a handful of open decisions in consider, nine things in progress,
 *    eighteen finished over the last three weeks, five archived.
 *  - Time pressure in every shape: two overdue, two due today, five in the
 *    next week, more further out, reminders later today and in days, snoozed
 *    items (`resurfaceAfter`), recurring chores, and rot (`timesDeferred`).
 *  - Blocked work: App Store submission waits on the sync fix, and the
 *    waitlist email waits on submission.
 *  - Consider tasks never carry a deadline, reminder or recurrence (createTask
 *    rejects them).
 *
 * Every date is relative to the seed run (see ./time). `createdAt` spreads
 * history over about eight weeks, and `completedAt` always follows it.
 */
import type { CreateTaskInput } from '../../src/db/types';
import { SEED_NOW, dateIn, daysAgo, daysFromNow, hoursAgo, ms, plus } from './time';

/** The seeded agents a task or note can belong to. The runner creates them. */
export type AgentSlug = 'fieldnote-ios' | 'fieldnote-site' | 'tidewater-shop' | 'roast-lab' | 'household';

export type SeedTask = Omit<CreateTaskInput, 'areaId' | 'rawInput' | 'parentId' | 'workspaceId'> & {
  area_name?: string;
  /** Title of an earlier-seeded task this one is a subtask of. */
  parent_title?: string;
  /** Title of an earlier-seeded task this one is blocked on. Resolved to
   *  `blockedOn` (the blocker's id) by the runner. */
  blocked_on_title?: string;
  /** Attaches the task to a seeded agent. Resolved by the runner. */
  agent_slug?: AgentSlug;
  rawInput?: string;
};

/**
 * Dedent a Markdown template literal: drops the leading and trailing blank
 * line and the common indent, so bodies can sit indented in the source while
 * keeping nested bullets intact.
 */
export function md(strings: TemplateStringsArray, ...values: unknown[]): string {
  const raw = strings.reduce((acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ''), '');
  const lines = raw.replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '').split('\n');
  const indents = lines.filter((line) => line.trim() !== '').map((line) => line.length - line.trimStart().length);
  const indent = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(indent)).join('\n');
}

/** A reminder a few hours after the seed runs, so it lands later the same day. */
const laterToday = (hours: number) => plus(SEED_NOW.toISOString(), hours * ms.hour);

export const tasks: SeedTask[] = [
  // ─── Tidewater Coffee ───────────────────────────────────────────
  {
    title: 'Hire a part-time production roaster',
    area_name: 'Tidewater Coffee',
    status: 'in_progress',
    energy: 'deep',
    effort: 'large',
    outcome: 'A second roaster trained and running Tuesday and Thursday production on their own.',
    createdAt: daysAgo(30, 21, 10),
    statusChangedAt: daysAgo(17, 21, 20),
    statusChangedCount: 1,
    lastProgressAt: daysAgo(1, 14, 30),
    body: md`
      ## Outcome
      Someone reliable roasting Tuesdays and Thursdays, so I stop roasting at 5am before long runs and Fieldnote nights.

      ## Why now
      Holiday wholesale volume roughly doubles from November. Last year I roasted six days a week through December and was a wreck by New Year.

      ## Plan
      - [x] Write the job post ($22 to $25/hr, 16 to 20 hrs/week)
      - [x] Post on Indeed and the local boards
      - [ ] Phone screens (7 of 23 applicants worth a call)
      - [ ] Two paid trial shifts with the top two
      - [ ] Offer, then payroll setup with Priya

      ## Notes
      - Must be able to lift and stack 70 lb sacks all shift. Said so in the post, not after.
      - Luis wants someone who can cover a market Saturday now and then. Nice to have, not a requirement.
    `,
  },
  {
    title: 'Write the roaster job post',
    area_name: 'Tidewater Coffee',
    parent_title: 'Hire a part-time production roaster',
    status: 'done',
    energy: 'light',
    effort: 'small',
    createdAt: daysAgo(30, 21, 12),
    completedAt: daysAgo(17, 21, 15),
    statusChangedAt: daysAgo(17, 21, 15),
    statusChangedCount: 2,
  },
  {
    title: 'Post the job on Indeed and local boards',
    area_name: 'Tidewater Coffee',
    parent_title: 'Hire a part-time production roaster',
    description: 'Indeed, the SCA job board, the Harbor Street Market newsletter, and the barista group.',
    status: 'done',
    energy: 'light',
    effort: 'trivial',
    createdAt: daysAgo(30, 21, 13),
    completedAt: daysAgo(15, 8, 40),
    statusChangedAt: daysAgo(15, 8, 40),
    statusChangedCount: 1,
  },
  {
    title: 'Phone screens with roaster applicants',
    area_name: 'Tidewater Coffee',
    parent_title: 'Hire a part-time production roaster',
    status: 'in_progress',
    energy: 'light',
    effort: 'medium',
    createdAt: daysAgo(30, 21, 14),
    statusChangedAt: daysAgo(9, 13, 0),
    statusChangedCount: 1,
    lastProgressAt: daysAgo(1, 14, 30),
    body: md`
      Seven worth calling out of 23 applicants. 20 minutes each, same four questions:

      1. Ever run a drum roaster? Which one, what batch size?
      2. Can you lift and stack 70 lb sacks all shift?
      3. Tuesday and Thursday, 6am to 2pm. Any conflicts?
      4. What do you want to be doing in two years?

      ## So far
      - **Marisol R.** Three years on a 22 kg at a big wholesale roaster, wants a smaller shop. Top pick.
      - **Kwame A.** Barista for six years, roasted on a 5 kg for his cafe. Strong, a bit far away.
      - **Ben K.** Home roaster, very keen, no production experience. Maybe for later.
      - **Hannah L.** Thursday at 3pm.
      - Devin, Abby, Tomas: emailed, no reply yet.
    `,
  },
  {
    title: 'Run trial roast shifts with the top two',
    area_name: 'Tidewater Coffee',
    parent_title: 'Hire a part-time production roaster',
    description: 'Paid, 4 hours each, on a real production day. Marisol and Kwame so far. Have them run the Guji profile.',
    status: 'todo',
    energy: 'deep',
    effort: 'small',
    createdAt: daysAgo(30, 21, 15),
  },
  {
    title: 'Order green coffee for winter',
    area_name: 'Tidewater Coffee',
    status: 'todo',
    energy: 'deep',
    effort: 'medium',
    hardDeadline: dateIn(3),
    outcome: 'Contract for the winter green signed with Meridian, landing before the holiday rush ends.',
    createdAt: daysAgo(12, 9, 30),
    body: md`
      ## Why the deadline
      Meridian holds offer-list prices until the end of the week. After that the Guji and the Huila lots go to the open list and we lose them.

      ## Plan
      - [x] Cup the offer samples (scores in {{note:Green coffee buying notes: 2026 harvest}})
      - [ ] Settle bag counts with Luis (he wants more Brazil for the espresso blend)
      - [ ] Re-cup Huila sample 2, it tasted papery on the cool down
      - [ ] Confirm space at the Pier 9 warehouse
      - [ ] Sign, pay the 30% deposit

      ## Rough order
      - Ethiopia Guji natural: 10 bags (60 kg each)
      - Colombia Huila washed: 8 bags (70 kg)
      - Brazil Cerrado: 12 bags (60 kg), espresso base
      - Guatemala Huehuetenango: 6 bags (69 kg)
      - Decaf, Mexico Mountain Water: 3 bags, only if we add decaf to the subscription

      Ballpark $21,400 before freight. Check against cash flow with Priya before signing.
    `,
  },
  {
    title: 'Cup the Meridian offer samples',
    area_name: 'Tidewater Coffee',
    description: '11 samples, cupped blind with Luis. Scores in the buying notes.',
    status: 'done',
    energy: 'deep',
    effort: 'small',
    createdAt: daysAgo(16, 8, 0),
    completedAt: daysAgo(9, 15, 0),
    statusChangedAt: daysAgo(9, 15, 0),
    statusChangedCount: 1,
  },
  {
    title: 'Prep for health inspection',
    area_name: 'Tidewater Coffee',
    status: 'todo',
    energy: 'light',
    effort: 'medium',
    hardDeadline: dateIn(16),
    createdAt: daysAgo(20, 11, 0),
    body: md`
      County re-inspection window opens on the deadline. The inspector only gives a "week of", so treat it as the first possible day.

      ## Checklist
      - [ ] Pest control visit booked and the log up to date
      - [ ] Sanitizer test strips restocked, log filled in daily for two weeks before
      - [ ] Hand sink: soap, paper towels, the "hands only" sign back up
      - [ ] Green sacks on pallets, 6 inches off the floor, nothing touching the wall
      - [ ] Fire extinguisher tag current, chaff bin emptied and logged
      - [ ] Food handler cards for me, Luis, and the new hire if they've started
      - [ ] Allergen line on retail labels
      - [ ] Trace one retail bag back to its roast batch, out loud, in under a minute

      Last inspection's notes are attached to this task.
    `,
  },
  {
    title: 'Wholesale order form: validate case quantities',
    area_name: 'Tidewater Coffee',
    agent_slug: 'tidewater-shop',
    status: 'done',
    energy: 'deep',
    effort: 'small',
    outcome: 'No more hand-fixed wholesale orders on Monday mornings.',
    createdAt: daysAgo(11, 20, 0),
    completedAt: daysAgo(4, 16, 20),
    statusChangedAt: daysAgo(4, 16, 20),
    statusChangedCount: 2,
    body: md`
      ## Problem
      Grain & Gather ordered half a case and it went straight through. Luis was fixing odd orders by hand every Monday.

      ## Rules
      - Whole cases only
      - 2-case minimum
      - Anything over 40 cases goes to Luis to confirm before it's accepted

      ## Done
      - [x] Form enforces whole cases and the minimum, with the reason shown inline
      - [x] Big orders route to Luis instead of straight onto the roast list
      - [x] Server rejects bad quantities too, so an old cached form can't sneak them in
      - [x] Tests built from the three accounts' real past orders
    `,
  },
  {
    title: 'Subscription: let customers skip a month',
    area_name: 'Tidewater Coffee',
    agent_slug: 'tidewater-shop',
    status: 'todo',
    energy: 'deep',
    effort: 'medium',
    createdAt: daysAgo(19, 21, 40),
    body: md`
      ## Why
      14 cancellations in the last three months where the reason was some version of "too much coffee right now". Half of them would have skipped instead. And subscribers keep emailing Luis to skip for vacations.

      ## Shape
      - Skip the next box from the account page. It pushes the next ship date a month, up to two skips in a row
      - Skips close on the 20th, when we roast for the box
      - Confirmation email with the date of the next box
      - Skips show up on Luis's packing list so we roast less

      ## Open question
      Does a skip push back the end date of a prepaid 3-month gift? Probably yes. Check what the gift emails promise first.
    `,
  },
  {
    title: 'Chart roast curves from Artisan logs',
    area_name: 'Tidewater Coffee',
    agent_slug: 'roast-lab',
    status: 'in_progress',
    energy: 'deep',
    effort: 'medium',
    createdAt: daysAgo(14, 20, 30),
    statusChangedAt: daysAgo(8, 19, 0),
    statusChangedCount: 1,
    lastProgressAt: daysAgo(3, 14, 40),
    body: md`
      ## Outcome
      One page per batch with bean temp, rate of rise and gas, overlaid on the target profile, so a drifting batch shows up before it reaches the cupping table.

      ## Plan
      - [x] Parse the .alog files from the roaster laptop's export folder
      - [x] Plot bean temp and RoR (smoothed over 30 seconds, on its own axis)
      - [x] Mark dry end, first crack and drop, with development time ratio
      - [ ] Overlay the target curve for each profile
      - [ ] Batch picker: last 20 roasts per coffee

      ## Notes
      First pass matches what Artisan shows. RoR is noise below 2 minutes, just clip it. Example output is in {{note:Roast profile notes: Guji natural}}.
    `,
  },
  {
    title: 'Refactor roast log parser into a package',
    area_name: 'Tidewater Coffee',
    agent_slug: 'roast-lab',
    description:
      'The parser lives inside the charting script. Pull it out into a package with a typed roast log, so batches can be compared (weight loss, development) and the inventory script can read the same files.',
    status: 'todo',
    energy: 'deep',
    effort: 'small',
    timesDeferred: 2,
    createdAt: daysAgo(13, 22, 0),
  },
  {
    title: 'Weekly roast schedule',
    area_name: 'Tidewater Coffee',
    description: "Build next week's batch list before the first roast day.",
    status: 'todo',
    energy: 'light',
    effort: 'small',
    recurrence: 'Weekly',
    nextRecurrenceAt: daysFromNow(2, 7),
    createdAt: daysAgo(56, 19, 0),
    body: md`
      - [ ] Pull standing wholesale orders and anything off-cycle
      - [ ] Subscription count for the month (ask Luis)
      - [ ] Market par: 40 x 12 oz across four coffees
      - [ ] Check green inventory against the batch list
      - [ ] Write it on the roastery whiteboard
    `,
  },
  {
    title: 'Send wholesale invoices',
    area_name: 'Tidewater Coffee',
    description:
      'Net 15. Little Owl, Grain & Gather (split by location), Northside Bakery, plus anyone who ordered off-cycle. Copy Priya.',
    status: 'todo',
    energy: 'light',
    effort: 'small',
    recurrence: 'Monthly',
    nextRecurrenceAt: daysFromNow(25, 9),
    createdAt: daysAgo(55, 9, 0),
  },
  {
    title: 'Get the holiday blend sample to Grain & Gather',
    area_name: 'Tidewater Coffee',
    description:
      'Rina is finalizing the holiday menu tomorrow. Two 12 oz bags of Winter Solstice, dropped at the Alder Street location.',
    status: 'todo',
    energy: 'light',
    effort: 'small',
    hardDeadline: dateIn(0),
    rawInput: 'G&G wants holiday blend samples before their menu meeting. 2 bags. Rina said by next week',
    createdAt: daysAgo(6, 9, 20),
  },
  {
    title: "Write next month's subscription box insert",
    area_name: 'Tidewater Coffee',
    description: 'Origin card for the Guji on the front, brew guide on the back. Luis needs it before the print cutoff.',
    status: 'todo',
    energy: 'light',
    effort: 'small',
    hardDeadline: dateIn(5),
    createdAt: daysAgo(9, 10, 0),
  },
  {
    title: 'Renew the farmers market vendor permit',
    area_name: 'Tidewater Coffee',
    description: 'Harbor Street Market, $340 for the winter season. Needs the updated insurance certificate attached.',
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    hardDeadline: dateIn(24),
    createdAt: daysAgo(18, 12, 0),
  },
  {
    title: "Update Little Owl's standing order",
    area_name: 'Tidewater Coffee',
    description:
      'Sam bumped the house blend from 30 to 36 lb a week starting next week. Update the sheet before Luis builds the delivery run.',
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    reminderAt: laterToday(3),
    createdAt: hoursAgo(26),
  },
  {
    title: 'Replace the afterburner thermocouple',
    area_name: 'Tidewater Coffee',
    description: 'Afterburner kept faulting around 1,350F. New K-type probe, $86. Ten minutes once the part showed up.',
    status: 'done',
    energy: 'deep',
    effort: 'small',
    createdAt: daysAgo(18, 7, 30),
    completedAt: daysAgo(11, 13, 0),
    statusChangedAt: daysAgo(11, 13, 0),
    statusChangedCount: 2,
  },
  {
    title: 'Packaging redesign',
    area_name: 'Tidewater Coffee',
    status: 'in_progress',
    energy: 'deep',
    effort: 'large',
    outcome: 'New bags on shelves for the holidays: compostable, one label system, roast date and lot printed.',
    createdAt: daysAgo(40, 20, 0),
    statusChangedAt: daysAgo(18, 17, 0),
    statusChangedCount: 1,
    lastProgressAt: daysAgo(9, 16, 0),
    body: md`
      ## Why
      Our kraft bags with sticker labels look homemade next to everything else on the Grain & Gather shelf. And handwriting roast dates on 300 bags a week is an hour of my life.

      ## Plan
      - [x] Pick a designer (Juniper Studio, $2,800 flat)
      - [ ] Settle the bag size question
      - [ ] Order sample bags
      - [ ] Final label files, with a lot number field
      - [ ] Photograph the new bags for the shop

      ## Notes
      Juniper's round 2 was close. Keep the heron, lose the script font. The lot number field also fixes the traceability question from the last inspection.
    `,
  },
  {
    title: 'Pick a packaging designer',
    area_name: 'Tidewater Coffee',
    parent_title: 'Packaging redesign',
    description: 'Juniper Studio. Best portfolio of the three and the only one who asked about our market stall.',
    status: 'done',
    energy: 'light',
    effort: 'small',
    createdAt: daysAgo(40, 20, 5),
    completedAt: daysAgo(18, 17, 0),
    statusChangedAt: daysAgo(18, 17, 0),
    statusChangedCount: 1,
  },
  {
    title: 'Decide: stay with 12 oz or switch to 250 g bags',
    area_name: 'Tidewater Coffee',
    parent_title: 'Packaging redesign',
    status: 'consider',
    energy: 'deep',
    effort: 'small',
    createdAt: daysAgo(21, 21, 0),
    body: md`
      **250 g:** what everyone else at the market is moving to, and it prices friendlier ($17 vs $19). Less coffee per bag, so margin goes up a little.

      **12 oz:** the subscription is sold in 12 oz, and Northside's retail shelf is built around it. Changing means reprinting the subscription page and explaining it to 180 people.

      Luis is for 250 g. I'm on the fence. Juniper needs the answer before final files.
    `,
  },
  {
    title: 'Order sample bags from the packaging supplier',
    area_name: 'Tidewater Coffee',
    parent_title: 'Packaging redesign',
    description: 'Three sizes, matte black and natural kraft, with the one-way valve. About $60 for samples.',
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    createdAt: daysAgo(18, 17, 10),
  },
  {
    title: 'Get final label files from Juniper Studio',
    area_name: 'Tidewater Coffee',
    parent_title: 'Packaging redesign',
    status: 'todo',
    energy: 'light',
    effort: 'small',
    createdAt: daysAgo(18, 17, 12),
  },
  {
    title: 'Open a Wednesday stall at Oak Park market',
    area_name: 'Tidewater Coffee',
    description:
      'Talked it through with Luis. Not enough hands until the new roaster is trained. Revisit in spring, if at all.',
    status: 'archived',
    energy: 'deep',
    effort: 'large',
    createdAt: daysAgo(52, 20, 0),
    statusChangedAt: daysAgo(26, 18, 0),
    statusChangedCount: 1,
  },
  {
    title: 'Add a decaf to the subscription lineup',
    area_name: 'Tidewater Coffee',
    description:
      "Four subscribers have asked. Meridian's Mountain Water Mexico cupped at 84, cleanest decaf we've had. Means a fifth SKU in the box rotation.",
    status: 'consider',
    createdAt: daysAgo(33, 22, 0),
  },

  // ─── Fieldnote ──────────────────────────────────────────────────
  {
    title: 'Fieldnote 1.0 launch',
    area_name: 'Fieldnote',
    status: 'in_progress',
    energy: 'deep',
    effort: 'epic',
    outcome: 'Fieldnote 1.0 live in the App Store while migration is still on, with the waitlist emailed the same day.',
    createdAt: daysAgo(52, 21, 30),
    statusChangedAt: daysAgo(45, 20, 0),
    statusChangedCount: 1,
    lastProgressAt: hoursAgo(3),
    body: md`
      ## Why now
      Migration is when birders log the most. If 1.0 lands in December, nobody opens it again until April.

      ## What's left
      Full list in {{note:Fieldnote 1.0 launch checklist}}. The short version:
      - The sync bug is the only real blocker ({{task:Fix offline sync dropping sightings}})
      - A privacy policy has to exist before review
      - Screenshots and listing copy

      ## Not in 1.0
      - Apple Watch app
      - Photo uploads
      - Shared lists with friends
    `,
  },
  {
    title: 'TestFlight round 2 with 40 testers',
    area_name: 'Fieldnote',
    parent_title: 'Fieldnote 1.0 launch',
    description: 'Build 0.9.3, two weeks. 27 of 40 replied. Feedback collected in the round 2 note.',
    status: 'done',
    energy: 'light',
    effort: 'medium',
    createdAt: daysAgo(35, 21, 0),
    completedAt: daysAgo(12, 22, 0),
    statusChangedAt: daysAgo(12, 22, 0),
    statusChangedCount: 2,
  },
  {
    title: 'Export sightings to eBird CSV',
    area_name: 'Fieldnote',
    parent_title: 'Fieldnote 1.0 launch',
    agent_slug: 'fieldnote-ios',
    description:
      "eBird Record Format, one checklist per location and morning. Request number one from round 1 testers. Reopened once when a tester's import choked on commas in a location name.",
    status: 'done',
    energy: 'deep',
    effort: 'medium',
    createdAt: daysAgo(30, 22, 0),
    completedAt: daysAgo(8, 23, 10),
    statusChangedAt: daysAgo(8, 23, 10),
    statusChangedCount: 3,
  },
  {
    title: 'Fix offline sync dropping sightings',
    area_name: 'Fieldnote',
    parent_title: 'Fieldnote 1.0 launch',
    agent_slug: 'fieldnote-ios',
    status: 'in_progress',
    energy: 'deep',
    effort: 'medium',
    outcome: 'A sighting logged without signal always reaches the server, even if the app is suspended or killed mid-upload.',
    createdAt: daysAgo(13, 22, 30),
    statusChangedAt: daysAgo(5, 20, 0),
    statusChangedCount: 2,
    lastProgressAt: hoursAgo(3),
    body: md`
      ## Repro
      1. Turn on Airplane Mode, log 3 to 5 sightings
      2. Turn Airplane Mode off and wait for the sync spinner
      3. Lock the phone within about 2 seconds
      4. Unlock after a minute: some are gone, locally AND on the server

      About 1 in 3 tries on my iPhone 13. Three testers hit it in the field. Gary lost a whole morning at the reservoir, 31 sightings. This morning on the riverside trail I logged 3 and only the waxwing made it.

      ## Hypothesis (confirmed by the logs)
      The sync worker pops sightings off the pending queue before the server confirms them, and the queue only lives in memory (pending.json exists but is never actually written). When iOS suspends or kills the app mid-upload, the completion never runs and the popped sightings are gone for good.

      ## Plan
      - [x] Log enqueue, pop and ack to a sync log in the app container
      - [x] Confirm with the logs: popped items with no ack after a suspend
      - [x] Persist the pending queue to pending.json, saved after every upload
      - [x] Drop a sighting from the queue only after a 201
      - [x] Tests that kill the app mid-flush and fail an upload
      - [ ] Review the branch, then TestFlight build 0.9.5
      - [ ] Client-generated id on every sighting so a retry can't duplicate
      - [ ] Move uploads to a background URL session so a lock doesn't cancel them
      - [ ] Field test: three mornings at the marsh, airplane mode on and off

      ## Notes
      - Don't change the format of sightings.json. Every tester's saved sightings live there.
      - Anything lost before 0.9.5 can't be recovered. It was never written to disk. Say so plainly to the testers.
      - The server already dedupes on (user, client id) if we send one. We just never did.
      - Design written up in {{note:Fieldnote sync architecture}}.
    `,
  },
  {
    title: 'Voice notes: transcribe on device',
    area_name: 'Fieldnote',
    parent_title: 'Fieldnote 1.0 launch',
    agent_slug: 'fieldnote-ios',
    status: 'in_progress',
    energy: 'deep',
    effort: 'large',
    createdAt: daysAgo(28, 21, 0),
    statusChangedAt: daysAgo(10, 21, 30),
    statusChangedCount: 1,
    lastProgressAt: daysAgo(1, 21, 0),
    body: md`
      ## Outcome
      Hold the button, say "two yellow-rumped warblers, one Cooper's hawk overhead", and get two correct entries with no network.

      ## Plan
      - [x] Spike on-device speech recognition, check accuracy in Airplane Mode
      - [x] Rough transcription into the note field (work in progress on the branch)
      - [ ] Species hints. iOS only takes about 100 per request, so pass the 100 most likely for where and when
      - [ ] Regional species data: about 1,100 North American species with range and season
      - [ ] Parse counts and species out of the transcript
      - [ ] Confirm sheet: show what it heard, one tap to fix
      - [ ] Keep the audio clip on the phone for 7 days in case the parse was wrong

      ## Misheard so far
      - "Cedar Waxwing" as "see the wax wing"
      - "Cooper's hawk" as "coopers talk"
      - "yellow-rumped" as "yellow rump" (fine, map it)
      - "kinglet" as "king lit"
      - "phoebe" as Phoebe, capitalized, like a person
    `,
  },
  {
    title: 'Launch landing page with waitlist',
    area_name: 'Fieldnote',
    parent_title: 'Fieldnote 1.0 launch',
    agent_slug: 'fieldnote-site',
    status: 'in_progress',
    energy: 'light',
    effort: 'medium',
    createdAt: daysAgo(22, 20, 0),
    statusChangedAt: daysAgo(6, 21, 0),
    statusChangedCount: 1,
    lastProgressAt: daysAgo(1, 22, 40),
    body: md`
      ## Outcome
      fieldnote.app live with a waitlist form, so the launch email has somewhere to point.

      ## Plan
      - [x] Hero ("Hear a bird? Just talk.") and three feature cards: voice, offline, life list
      - [x] Waitlist form on Netlify Forms, with a one-line no-spam promise
      - [x] PR #12 with a deploy preview. Review accepted
      - [ ] Merge, and point fieldnote.app at it
      - [ ] Phone mockup using the onboarding screens ({{note:Fieldnote onboarding flow}})
      - [ ] OG image and favicon
      - [ ] Privacy page (waiting on the policy itself)

      212 people on the waitlist already, mostly from one mention in the bird club newsletter.
    `,
  },
  {
    title: 'Write the privacy policy',
    area_name: 'Fieldnote',
    parent_title: 'Fieldnote 1.0 launch',
    status: 'todo',
    energy: 'light',
    effort: 'small',
    timesDeferred: 3,
    createdAt: daysAgo(26, 21, 0),
    body: md`
      Has to exist before App Store review and before the landing page can link to it.

      ## What it has to say
      - Location is stored with each sighting and only synced to your own account
      - Audio is transcribed on the phone, never uploaded, clips deleted after 7 days
      - eBird export happens on your phone. We never touch your eBird account
      - Crash reports are anonymous and carry no sighting data
      - Deleting your account deletes everything within 30 days

      Start from the bird club's own policy, then ask Theo's cousin (the lawyer) to skim it.
    `,
  },
  {
    title: 'App Store screenshots and listing copy',
    area_name: 'Fieldnote',
    parent_title: 'Fieldnote 1.0 launch',
    description: '6.7 inch and 5.5 inch sets. Lead with the voice entry screen. Subtitle: "Log birds by voice, even offline."',
    status: 'todo',
    energy: 'light',
    effort: 'medium',
    createdAt: daysAgo(20, 22, 0),
  },
  {
    title: 'Submit Fieldnote 1.0 to App Store review',
    area_name: 'Fieldnote',
    parent_title: 'Fieldnote 1.0 launch',
    description:
      'Submitting by the deadline leaves a week of review slack before the Big Sit weekend, when the bird club logs all day.',
    status: 'todo',
    energy: 'deep',
    effort: 'small',
    hardDeadline: dateIn(9),
    blocked_on_title: 'Fix offline sync dropping sightings',
    blockedSince: daysAgo(5, 20, 5),
    createdAt: daysAgo(26, 21, 10),
  },
  {
    title: 'Email the waitlist when 1.0 is live',
    area_name: 'Fieldnote',
    parent_title: 'Fieldnote 1.0 launch',
    agent_slug: 'fieldnote-site',
    description: 'Short. One screenshot, the App Store link, a thank-you to the testers. Draft it now, send it the day Apple approves.',
    status: 'todo',
    energy: 'light',
    effort: 'small',
    blocked_on_title: 'Submit Fieldnote 1.0 to App Store review',
    blockedSince: daysAgo(5, 20, 6),
    createdAt: daysAgo(15, 21, 0),
  },
  {
    title: 'Set up the fieldnote-site repo and preview deploys',
    area_name: 'Fieldnote',
    agent_slug: 'fieldnote-site',
    description: 'Every branch gets a preview URL. Domain pointed, HTTPS working.',
    status: 'done',
    energy: 'light',
    effort: 'small',
    createdAt: daysAgo(22, 20, 10),
    completedAt: daysAgo(19, 23, 0),
    statusChangedAt: daysAgo(19, 23, 0),
    statusChangedCount: 1,
  },
  {
    title: 'Renew the Apple developer membership',
    area_name: 'Fieldnote',
    description: '$99. If it lapses, TestFlight builds stop working for all 40 testers.',
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    hardDeadline: dateIn(6),
    rawInput: 'apple dev account renewal email, expires next week. DO NOT let testflight die',
    createdAt: daysAgo(3, 9, 40),
  },
  {
    title: 'Reply to testers who lost sightings',
    area_name: 'Fieldnote',
    description:
      'Gary, Ines and Paul. The fix is in review and ships in 0.9.5. Be straight with them: anything already lost is gone, it was never written to disk. Offer Gary a free year.',
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    reminderAt: daysFromNow(1, 19, 30),
    createdAt: daysAgo(4, 22, 0),
  },
  {
    title: 'Decide Fieldnote pricing',
    area_name: 'Fieldnote',
    status: 'consider',
    energy: 'deep',
    effort: 'small',
    createdAt: daysAgo(15, 22, 30),
    body: md`
      Options so far:
      - **$4.99 once.** Simple, birders like it, no recurring revenue.
      - **Free, with $14.99 a year** for unlimited voice entries and eBird export.
      - **Free for 1.0**, decide after 500 people use it.

      Round 2 testers were loud about subscriptions ({{note:TestFlight feedback, round 2}}). Leaning toward the third so pricing doesn't hold up the launch.
    `,
  },
  {
    title: 'Fieldnote Apple Watch app',
    area_name: 'Fieldnote',
    description: 'Cut from 1.0. Tap-to-log on the wrist is lovely but doubles the sync surface. Not before 1.1.',
    status: 'archived',
    energy: 'deep',
    effort: 'large',
    createdAt: daysAgo(49, 22, 0),
    statusChangedAt: daysAgo(31, 21, 0),
    statusChangedCount: 1,
  },

  // ─── Health ─────────────────────────────────────────────────────
  {
    title: 'Twin Rivers Marathon race prep',
    area_name: 'Health',
    status: 'todo',
    energy: 'deep',
    effort: 'large',
    outcome: 'On the start line healthy, with fueling, pacing and logistics settled.',
    createdAt: daysAgo(46, 7, 0),
    body: md`
      ## Goal
      3:45, which is 8:35 a mile. Stretch goal 3:40 if the calf holds. Floor: finish without walking.

      ## Before race week
      - [ ] Physio for the calf ({{task:Book physio for calf strain}})
      - [ ] Practice race fueling on the 18 and the 20
      - [ ] Taper plan written down, so I don't panic and run extra miles

      ## Race week
      - [ ] Bib pickup at the expo (Saturday only, Luis covers the market)
      - [ ] Theo and Ruby at mile 20 with the sign
      - [ ] Lay out kit Friday night, pin the bib Saturday
    `,
  },
  {
    title: 'Pick up race bib at the expo',
    area_name: 'Health',
    parent_title: 'Twin Rivers Marathon race prep',
    description: 'Saturday only, 10am to 6pm at the convention center. Photo ID and the confirmation email.',
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    hardDeadline: dateIn(32),
    createdAt: daysAgo(46, 7, 5),
  },
  {
    title: 'Test race-day gels on long runs',
    area_name: 'Health',
    parent_title: 'Twin Rivers Marathon race prep',
    description: 'Gel every 35 minutes. The caffeinated one at mile 12 wrecked my stomach in week 9. Plain ones on the 18 and the 20.',
    status: 'todo',
    energy: 'light',
    effort: 'small',
    createdAt: daysAgo(40, 19, 0),
  },
  {
    title: 'Write the taper plan',
    area_name: 'Health',
    parent_title: 'Twin Rivers Marathon race prep',
    status: 'todo',
    energy: 'light',
    effort: 'small',
    createdAt: daysAgo(12, 20, 0),
  },
  {
    title: 'Long run: 18 miles',
    area_name: 'Health',
    status: 'todo',
    energy: 'deep',
    effort: 'medium',
    hardDeadline: dateIn(0),
    createdAt: daysAgo(7, 12, 0),
    body: md`
      River loop twice plus the out-and-back to the boathouse. Steady, 9:00 to 9:15 a mile.

      - [ ] Gels at miles 5, 10 and 14 (plain, not caffeinated)
      - [ ] Refill at the boathouse fountain
      - [ ] Calf check at mile 8. If it's tight, cut to 14 and call it a win

      Week 12 of {{note:Marathon training plan (16 weeks)}}.
    `,
  },
  {
    title: 'Long run: 16 miles',
    area_name: 'Health',
    description: '2:24:40, 9:03 average. Calf tightened on the hill at 13, fine after. Splits in the training plan note.',
    status: 'done',
    energy: 'deep',
    effort: 'medium',
    createdAt: daysAgo(14, 12, 0),
    completedAt: daysAgo(7, 9, 50),
    statusChangedAt: daysAgo(7, 9, 50),
    statusChangedCount: 1,
  },
  {
    title: 'Book physio for calf strain',
    area_name: 'Health',
    description:
      'Jonas at Kinetic Physio, 555-0193. Left calf, tight after mile 12 on long runs. Be seen before the 20 miler, not after.',
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    hardDeadline: dateIn(-1),
    rawInput: 'calf is tight again after the 16, like the lower part, left side. need to actually book Jonas this time',
    createdAt: daysAgo(5, 11, 10),
  },
  {
    title: 'Strength: calf and hip routine',
    area_name: 'Health',
    status: 'todo',
    energy: 'light',
    effort: 'small',
    recurrence: 'Weekly',
    nextRecurrenceAt: daysFromNow(1, 6, 30),
    createdAt: daysAgo(36, 6, 30),
    body: md`
      20 minutes. Twice a week if I'm honest, once if I'm realistic.

      - Single-leg calf raises, 3 x 15, straight knee and bent knee
      - Clamshells, 3 x 20
      - Bulgarian split squats, 3 x 8
      - Side plank, 3 x 30 seconds
    `,
  },
  {
    title: 'Get bloodwork done (ferritin and vitamin D)',
    area_name: 'Health',
    description: "Dr. Osei wanted a recheck after last spring's low ferritin. Honestly, after the race.",
    status: 'todo',
    energy: 'light',
    effort: 'small',
    timesDeferred: 3,
    resurfaceAfter: dateIn(36),
    createdAt: daysAgo(50, 8, 0),
  },
  {
    title: 'Try no screens after 9:30 for two weeks',
    area_name: 'Health',
    description:
      'Sleep score averages 71 on nights I am in Xcode until 11, and 82 when I am not. Probably obvious. Worth proving to myself.',
    status: 'consider',
    createdAt: daysAgo(17, 23, 30),
  },

  // ─── Family ─────────────────────────────────────────────────────
  {
    title: "Ruby's 8th birthday party",
    area_name: 'Family',
    description: 'Mid-December, about 12 kids. Ruby has requested "a dog party", with Pepper as guest of honor.',
    outcome: 'A party Ruby talks about until spring, and a house that survives it.',
    status: 'todo',
    energy: 'light',
    effort: 'medium',
    createdAt: daysAgo(10, 20, 30),
  },
  {
    title: 'Decide: roller rink or backyard party',
    area_name: 'Family',
    parent_title: "Ruby's 8th birthday party",
    description:
      'Roller rink is $28 a kid with pizza and zero cleanup. Backyard in December is a gamble and a mess, but Pepper can come.',
    status: 'consider',
    createdAt: daysAgo(10, 20, 35),
  },
  {
    title: 'Send birthday invites',
    area_name: 'Family',
    parent_title: "Ruby's 8th birthday party",
    description: 'Whole class (22) or the 8 kids she actually plays with? Ask Ms. Adeyemi about the class rule.',
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    createdAt: daysAgo(10, 20, 40),
  },
  {
    title: 'Order the birthday cake',
    area_name: 'Family',
    parent_title: "Ruby's 8th birthday party",
    description: 'Northside Bakery does dog-shaped cakes. Gus needs two weeks notice. Ask for the wholesale-friend price, ha.',
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    createdAt: daysAgo(10, 20, 45),
  },
  {
    title: "Ruby's field trip permission slip",
    area_name: 'Family',
    description: "Aquarium trip. Sign it and put $12 in the folder. Neither of us can chaperone (roast day, Theo's teaching).",
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    hardDeadline: dateIn(1),
    rawInput: "Photo of the field trip form from Ruby's folder",
    createdAt: daysAgo(2, 16, 20),
  },
  {
    title: "Ruby: RSVP to Nora's birthday party",
    area_name: 'Family',
    description: "Text Nora's mom Jess, 555-0148. Saturday 2pm at the trampoline park. Theo can take her after soccer.",
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    hardDeadline: dateIn(-2),
    createdAt: daysAgo(8, 18, 0),
  },
  {
    title: "Plan Thanksgiving with Theo's parents",
    area_name: 'Family',
    status: 'consider',
    energy: 'light',
    effort: 'medium',
    createdAt: daysAgo(9, 21, 0),
    body: md`
      Ray and Linda want to come for the whole week. Theo thinks four nights. I think four nights.

      ## Open questions
      - Where do they sleep? Ruby's room (she's thrilled) or the air mattress in the office, which is my Fieldnote desk
      - Do we host, or go to the Arroyos'? Luis invited us
      - Linda can't do gluten anymore. The stuffing question
      - Are they flying, or driving the 9 hours again?

      Talk to Theo this weekend, then call Linda.
    `,
  },
  {
    title: "Pepper's annual vet visit",
    area_name: 'Family',
    description: 'Rabies and DHPP done. 46 lb, the vet would like her at 43. Fewer market scones.',
    status: 'done',
    energy: 'light',
    effort: 'small',
    createdAt: daysAgo(24, 9, 0),
    completedAt: daysAgo(10, 16, 0),
    statusChangedAt: daysAgo(10, 16, 0),
    statusChangedCount: 1,
  },
  {
    title: "Order Pepper's flea and tick meds",
    area_name: 'Family',
    description: 'Three-month chew. $64 at the vet or $51 online. Last dose runs out next week.',
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    reminderAt: laterToday(5),
    createdAt: daysAgo(1, 8, 15),
  },
  {
    title: "Schedule Ruby's parent-teacher conference",
    area_name: 'Family',
    status: 'done',
    energy: 'light',
    effort: 'trivial',
    createdAt: daysAgo(13, 19, 0),
    completedAt: daysAgo(6, 20, 0),
    statusChangedAt: daysAgo(6, 20, 0),
    statusChangedCount: 1,
  },
  {
    title: 'Buy Ruby new soccer cleats',
    area_name: 'Family',
    description: 'Youth size 13. She grew a full size since spring.',
    status: 'done',
    energy: 'light',
    effort: 'trivial',
    createdAt: daysAgo(23, 7, 30),
    completedAt: daysAgo(20, 18, 0),
    statusChangedAt: daysAgo(20, 18, 0),
    statusChangedCount: 1,
  },
  {
    title: 'Date night with Theo',
    area_name: 'Family',
    description: 'The Thai place on 14th reopened. Ask Ines next door if she can babysit Friday.',
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    reminderAt: daysFromNow(3, 12),
    createdAt: daysAgo(3, 22, 30),
  },

  // ─── The Bungalow ───────────────────────────────────────────────
  {
    title: 'Get three quotes for the panel upgrade',
    area_name: 'The Bungalow',
    description: 'Bright Spark $6,850, Volt Bros $8,200, Ruiz Electric $7,400 with no permit. Went with Dana at Bright Spark.',
    status: 'done',
    energy: 'light',
    effort: 'small',
    createdAt: daysAgo(42, 19, 0),
    completedAt: daysAgo(16, 12, 0),
    statusChangedAt: daysAgo(16, 12, 0),
    statusChangedCount: 2,
  },
  {
    title: 'Call Dana about the panel upgrade',
    area_name: 'The Bungalow',
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    hardDeadline: dateIn(2),
    createdAt: daysAgo(3, 8, 0),
    body: md`
      Dana Whitfield at Bright Spark. Number in {{note:Bungalow contractor contacts}}.

      Ask:
      - Is the permit filed? She said "this week" two weeks ago
      - Utility disconnect date, and how long the power is out (fridge plan)
      - Are the 2 new kitchen circuits still inside the $6,850 after the site visit?
      - Deposit is $1,500. Check or card?
    `,
  },
  {
    title: 'Pick the kitchen backsplash tile',
    area_name: 'The Bungalow',
    status: 'consider',
    energy: 'light',
    effort: 'small',
    createdAt: daysAgo(27, 20, 0),
    body: md`
      Three samples taped to the wall for a week:

      {{file:backsplash-options.png}}

      - **Zellige, sea glass** ($38/sq ft). My pick. Uneven on purpose, which Theo calls "crooked".
      - **Subway, matte white** ($9/sq ft). Safe, cheap, a bit plain. Nobody's first choice, everyone's fallback.
      - **Hex, terracotta** ($22/sq ft). Theo loves it. Suits a 1924 house, but busy next to the oak floors.

      About 32 sq ft with waste, so roughly $1,220 vs $290 vs $700 before install.

      Decide before Dana closes up the wall for the new circuits, so Andre can tile right after.
    `,
  },
  {
    title: 'Fix the leaky skylight',
    area_name: 'The Bungalow',
    description:
      'Bathroom skylight drips in heavy rain. Bucket under it for seven weeks now. Hector quoted $400 to reflash or $1,900 to replace.',
    status: 'todo',
    energy: 'light',
    effort: 'medium',
    timesDeferred: 4,
    createdAt: daysAgo(49, 7, 45),
  },
  {
    title: 'Clean the gutters',
    area_name: 'The Bungalow',
    description: "Wait until the big maple drops most of its leaves, otherwise I'm doing it twice. Borrow Gil's tall ladder.",
    status: 'todo',
    energy: 'light',
    effort: 'small',
    resurfaceAfter: dateIn(5),
    createdAt: daysAgo(20, 17, 0),
  },
  {
    title: 'Water the fiddle leaf fig',
    area_name: 'The Bungalow',
    description: "One liter, then rotate it a quarter turn. It dropped two leaves, so that's not a reason to water more.",
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    recurrence: 'Weekly',
    nextRecurrenceAt: daysFromNow(4, 8),
    createdAt: daysAgo(56, 9, 0),
  },
  {
    title: 'Plant garlic in the raised beds',
    area_name: 'The Bungalow',
    description: 'Music hardneck, 40 cloves in the back two beds, mulched with straw. Ruby did the labels.',
    status: 'done',
    energy: 'light',
    effort: 'small',
    createdAt: daysAgo(12, 18, 0),
    completedAt: daysAgo(2, 15, 0),
    statusChangedAt: daysAgo(2, 15, 0),
    statusChangedCount: 1,
  },
  {
    title: 'Replace the porch light fixture',
    area_name: 'The Bungalow',
    description: "New fixture has been in its box in the garage since summer. Dana says it doesn't need to wait for the panel.",
    status: 'todo',
    energy: 'light',
    effort: 'small',
    timesDeferred: 2,
    createdAt: daysAgo(38, 19, 30),
  },

  // ─── Money ──────────────────────────────────────────────────────
  {
    title: 'Organize 2026 tax documents',
    area_name: 'Money',
    agent_slug: 'household',
    status: 'in_progress',
    energy: 'light',
    effort: 'medium',
    outcome: 'One folder Priya can work from in January, so the return is not an April scramble again.',
    createdAt: daysAgo(25, 20, 0),
    statusChangedAt: daysAgo(14, 19, 30),
    statusChangedCount: 1,
    lastProgressAt: daysAgo(1, 10, 0),
    body: md`
      ## Plan
      - [x] Folder structure: income, business, house, Ruby, medical
      - [x] Mortgage interest and property tax statements
      - [ ] Tidewater K-1 (Priya produces it after the LLC return)
      - [ ] After-school care receipts for the last quarter
      - [ ] Fieldnote expenses as their own list: developer fee, server, domain
      - [ ] Ruby's 529 contribution statement
      - [ ] Physio receipts (probably not enough to matter, keep anyway)
      - [ ] Donation receipts: garden co-op, the school auction

      ## Notes
      The household agent keeps a checklist and a one-page summary for Priya next to the inbox folder, and never moves the originals. Its heads-up worth passing on: the 1099-K is gross card volume, not profit, so Priya should reconcile it against the books.
    `,
  },
  {
    title: 'Renew home insurance',
    area_name: 'Money',
    status: 'todo',
    energy: 'light',
    effort: 'small',
    hardDeadline: dateIn(12),
    createdAt: daysAgo(8, 19, 0),
    body: md`
      Renewal notice: {{file:insurance-renewal.pdf}}

      Harbor Mutual wants $1,842 a year, up 11% from $1,659. Before just paying it:
      - [ ] Call Rosa about the roof surcharge (roof over 20 years). A condition letter from Hector after the skylight fix might knock it off ({{task:Fix the leaky skylight}})
      - [ ] Ask what the Federal Pacific panel is costing us, and for a discount once it's replaced
      - [ ] One comparison quote. Theo's union has a group rate
      - [ ] The deductible is already $2,500, so there's nothing left to squeeze there
    `,
  },
  {
    title: 'Pay Q4 estimated taxes',
    area_name: 'Money',
    description:
      'Federal and state. Priya sends the amounts in early January. Reminder is early so there is time to move cash from the roastery draw.',
    status: 'todo',
    energy: 'light',
    effort: 'small',
    reminderAt: daysFromNow(40),
    createdAt: daysAgo(21, 11, 15),
  },
  {
    title: 'Pay Q3 estimated taxes',
    area_name: 'Money',
    description: '$3,150 federal, $820 state. Paid from the tax savings account.',
    status: 'done',
    energy: 'light',
    effort: 'small',
    createdAt: daysAgo(40, 9, 0),
    completedAt: daysAgo(21, 11, 0),
    statusChangedAt: daysAgo(21, 11, 0),
    statusChangedCount: 1,
  },
  {
    title: "Send Priya last month's receipts",
    area_name: 'Money',
    status: 'done',
    energy: 'light',
    effort: 'trivial',
    createdAt: daysAgo(5, 9, 0),
    completedAt: daysAgo(3, 20, 30),
    statusChangedAt: daysAgo(3, 20, 30),
    statusChangedCount: 1,
  },
  {
    title: 'Compare mortgage refinance offers',
    area_name: 'Money',
    status: 'consider',
    energy: 'deep',
    effort: 'medium',
    timesDeferred: 1,
    resurfaceAfter: dateIn(14),
    createdAt: daysAgo(30, 21, 0),
    body: md`
      Current loan: 6.875%, about $312k left, 27 years to go.

      - **Credit union:** 6.125%, $4,900 closing, saves about $155 a month. Breakeven around 32 months.
      - **Online lender:** 5.99%, $7,200 closing, saves about $180 a month. Breakeven around 40 months.
      - **Current servicer:** "call back next month".

      Only worth it if we stay four or more years, which we will. Waiting two weeks to see where rates settle.
    `,
  },
  {
    title: "Bump Ruby's 529 contribution",
    area_name: 'Money',
    description: 'From $100 to $150 a month. A five-minute job that has been on this list for two months.',
    status: 'todo',
    energy: 'light',
    effort: 'trivial',
    timesDeferred: 6,
    createdAt: daysAgo(54, 21, 0),
  },

  // ─── Garden Co-op ───────────────────────────────────────────────
  {
    title: 'Hand the treasurer books to Joan',
    area_name: 'Garden Co-op',
    description:
      'Reconcile the bank account through last month, export the ledger, write down the recurring payments, and swap signers at the bank. Joan has been patient.',
    status: 'todo',
    energy: 'light',
    effort: 'medium',
    timesDeferred: 5,
    resurfaceAfter: dateIn(21),
    createdAt: daysAgo(53, 20, 0),
  },
  {
    title: 'Apply for the city neighborhood mini-grant',
    area_name: 'Garden Co-op',
    description:
      'Up to $5,000 for the tool shed roof and a second water line. Applications close in January. Someone else should lead this one.',
    status: 'consider',
    createdAt: daysAgo(44, 21, 0),
  },

  // ─── Portuguese ─────────────────────────────────────────────────
  {
    title: 'Portuguese lesson with Ana',
    area_name: 'Portuguese',
    description: 'Wednesday evenings, video. Bring five new phrases from the week and the homework.',
    status: 'todo',
    energy: 'light',
    effort: 'small',
    recurrence: 'Weekly',
    nextRecurrenceAt: daysFromNow(1, 19),
    createdAt: daysAgo(56, 20, 0),
  },
  {
    title: 'Finish Unit 4: pretérito perfeito',
    area_name: 'Portuguese',
    description: 'Finally get when it is falei and when it is falava. Mostly.',
    status: 'done',
    energy: 'deep',
    effort: 'small',
    createdAt: daysAgo(19, 20, 0),
    completedAt: daysAgo(5, 21, 30),
    statusChangedAt: daysAgo(5, 21, 30),
    statusChangedCount: 2,
  },
  {
    title: 'Renew my passport before Lisbon',
    area_name: 'Portuguese',
    description:
      'Mine expires in June, and Portugal wants three months of validity past the trip. Routine processing is 6 to 8 weeks. Do it before the holidays eat it.',
    status: 'todo',
    energy: 'light',
    effort: 'small',
    reminderAt: daysFromNow(10),
    createdAt: daysAgo(16, 21, 0),
  },
  {
    title: 'Book the Porto apartment',
    area_name: 'Portuguese',
    status: 'todo',
    energy: 'light',
    effort: 'small',
    createdAt: daysAgo(11, 21, 30),
    body: md`
      Five nights, two bedrooms, under €140 a night, washer if possible. Cedofeita is the front-runner.

      Shortlist is in {{note:Lisbon and Porto trip ideas}}.
    `,
  },
  {
    title: 'Day trip: Sintra or the Douro Valley?',
    area_name: 'Portuguese',
    description:
      'Ruby will love Pena Palace. The Douro is wine country, which she will not love. Could do both if we cut a Lisbon day.',
    status: 'consider',
    createdAt: daysAgo(11, 21, 40),
  },

  // ─── Brightline Analytics ───────────────────────────────────────
  {
    title: 'Hand off the churn dashboards to Marcus',
    area_name: 'Brightline Analytics',
    description: 'Imported from my old list. Marcus has had the docs since my last week, nothing left to do.',
    status: 'archived',
    createdAt: daysAgo(57, 21, 0),
    statusChangedAt: daysAgo(50, 20, 0),
    statusChangedCount: 1,
  },
  {
    title: 'File the expense report for the Denver offsite',
    area_name: 'Brightline Analytics',
    description: 'Way past the 60-day window. Eating the $84.',
    status: 'archived',
    createdAt: daysAgo(57, 21, 2),
    statusChangedAt: daysAgo(50, 20, 2),
    statusChangedCount: 1,
  },
  {
    title: 'Write a recommendation for Jordan',
    area_name: 'Brightline Analytics',
    description: 'Jordan landed the job without it. Sent a congrats note instead.',
    status: 'archived',
    createdAt: daysAgo(57, 21, 4),
    statusChangedAt: daysAgo(44, 18, 0),
    statusChangedCount: 1,
  },
];
