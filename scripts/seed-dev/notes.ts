/**
 * Notes for the shared dev seed. Optionally attach a note to an area
 * (`area_name`) or a task (`task_title`). The runner resolves both names
 * to ids after areas + tasks are created.
 *
 * The set below shows the range:
 *   - Reference notes attached to an area (Sammy's pickup window, contractor
 *     contacts, reading list)
 *   - Decision/rationale notes attached to an area (architectural decisions
 *     in AI Assistant)
 *   - Observation/idea notes attached to an area (investment thesis,
 *     essay seeds)
 *   - Knowledge notes attached to a task (book takeaways pinned to the
 *     reading task — when the task completes, the note lives on)
 *
 * No tags. No sub-areas. Cross-cutting happens through the area and the
 * task linkage; richer cross-cutting will arrive with the links table.
 */
import type { CreateNoteInput } from '../../src/db/types';

export type SeedNote = Omit<CreateNoteInput, 'areaId' | 'taskId'> & {
  area_name?: string;
  task_title?: string;
};

export const notes: SeedNote[] = [
  // ─── AI Assistant ───────────────────────────────────────────────
  {
    title: 'Open issues from self-dogfooding',
    area_name: 'AI Assistant',
    body:
      "Bugs and friction I hit using this thing on real captures. Pick top 3 " +
      "before V1 alpha.\n\n" +
      "- Mobile capture: voice button is too small, missed taps when walking\n" +
      "- Search results don't show which area the match came from\n" +
      "- Subtask completion does not bubble up visually to the parent\n" +
      "- Cmd-K does nothing — feels broken, even though there is no shortcut\n" +
      "- Linking a note to a task buries the link in a dropdown — should be inline\n" +
      "- After completing a recurring task, the next instance does not show a " +
      "  due date until you open the detail view\n" +
      "- Onboarding asks for a name before showing anything useful",
  },
  {
    title: 'Roadmap — next 3 things',
    area_name: 'AI Assistant',
    body:
      "Rolling list. Top of the list is what I would work on tomorrow.\n\n" +
      "1. Ship V1 alpha to friends (active project)\n" +
      "2. Voice capture quality pass — current STT misses 1-in-5 words on noisy " +
      "   input, makes captures unreliable\n" +
      "3. Inbox triage view — surface unsorted captures with a one-tap area " +
      "   suggestion, accept or override\n\n" +
      "Out of scope until V1 ships:\n" +
      "- Multi-device sync\n" +
      "- Calendar integration\n" +
      "- Public API for agents",
  },
  {
    title: 'Open product questions',
    area_name: 'AI Assistant',
    body:
      "Decisions I am circling. Sit with each before committing.\n\n" +
      "- Should completed tasks disappear from the area view, or stay greyed " +
      "  out for a few days? Disappearing feels clean but loses context. " +
      "  Greying out feels honest but clutters.\n" +
      "- Daily review: opt-in or default-on? Default-on creates muscle memory; " +
      "  opt-in respects that not everyone wants this.\n" +
      "- How aggressive should AI be about suggesting area splits? Once a " +
      "  quarter feels right, but the trigger is fuzzy.\n" +
      "- Should the assistant chat have memory across sessions or each session " +
      "  fresh? Memory is powerful but invisible state is scary.",
  },

  // ─── Health ─────────────────────────────────────────────────────
  {
    title: 'Sleep stack — what works',
    area_name: 'Health',
    body:
      "Durable observations. Update as evidence accumulates.\n\n" +
      "- 7.5–8h target window\n" +
      "- 18C bedroom, blackout curtains\n" +
      "- No caffeine after noon (after 10am on bad days)\n" +
      "- Last meal 3+ hours before bed\n" +
      "- Phone on nightstand stays in DND\n\n" +
      "Open experiments: blue blockers from 8pm (see active task).",
  },
  {
    title: 'Cardio zones (max HR 184)',
    area_name: 'Health',
    body:
      "Reference for training plan.\n\n" +
      "- Z2: 110–129 (conversational, 80% of weekly volume)\n" +
      "- Z3: 130–147 (tempo)\n" +
      "- Z4: 148–166 (threshold, 1x/week)\n" +
      "- Z5: 167–184 (VO2 intervals, 1x/2 weeks)",
  },
  {
    title: 'Day 4 observations',
    task_title: 'Sleep stack experiment: blue blockers + 18C',
    body:
      "Sleep score 89 (baseline avg 81). HRV 62 (baseline 54). " +
      "Subjective: easier sleep onset, no 3am wake. Holding pattern.",
  },

  // ─── Family ─────────────────────────────────────────────────────
  {
    title: "Sammy's school pickup window",
    area_name: 'Family',
    body:
      "Tu/Th: 2:30–3:00 PM (early dismissal).\n" +
      "M/W/F: 3:15 PM (regular).\n\n" +
      "Late pickup grace: 10 min, then $5/min charge after.\n" +
      "Backup pickup: Aunt Jen — on the approved list.",
  },
  {
    title: 'Birthdays this year',
    area_name: 'Family',
    body:
      "Reference list. Move to calendar with reminders by January each year.\n\n" +
      "- Mom: March 14\n" +
      "- Dad: August 22\n" +
      "- Sis: November 6\n" +
      "- Sammy: July 19\n" +
      "- Partner: October 3",
  },
  {
    title: "Trip constraints — kids' edition",
    task_title: 'Plan summer trip with kids',
    body:
      "Hard constraints to filter destinations against:\n\n" +
      "- Flight ≤ 6h (Sammy can't sleep on planes)\n" +
      "- Pool or beach access at lodging (non-negotiable for the kid sanity factor)\n" +
      "- Walkable area for evenings (no rental car required at night)\n" +
      "- At least one rainy-day backup activity",
  },

  // ─── Home ───────────────────────────────────────────────────────
  {
    title: 'Contractor contacts',
    area_name: 'Home',
    body:
      "- **General contractor**: Mike (referred by a friend). Kitchen, bath, " +
      "  whole-house. 555-0142.\n" +
      "- **Chimney sweep**: local service, annual visit in November. 555-0188.\n" +
      "- **Plumber**: 555-0166, has a 24h emergency line.\n" +
      "- **Electrician**: still looking — ask around.",
  },
  {
    title: 'Kitchen specs and measurements',
    task_title: 'Kitchen renovation',
    body:
      "Pre-demo measurements (2026-04-15).\n\n" +
      "- Galley: 14'2\" × 9'6\"\n" +
      "- Existing cabinets: 8 base, 6 upper, plus pantry tower\n" +
      "- Window above sink: 36\" × 42\", non-removable\n" +
      "- Plumbing on east wall, gas on south wall\n" +
      "- Sub-floor: 3/4\" plywood, in good shape per inspection",
  },
  {
    title: 'House maintenance calendar',
    area_name: 'Home',
    body:
      "Recurring maintenance, set as recurring tasks where possible.\n\n" +
      "- Water filter: every 6 months\n" +
      "- HVAC filter: monthly check, replace quarterly\n" +
      "- Gutters: spring + fall\n" +
      "- Chimney sweep: annually, November\n" +
      "- Smoke/CO detectors: test monthly, batteries annually\n" +
      "- Termite inspection: annually, March",
  },

  // ─── Finance ────────────────────────────────────────────────────
  {
    title: 'Tax document checklist',
    area_name: 'Finance',
    body:
      "Annual filing reference. Pin to the spring tax task.\n\n" +
      "Income: W-2s, 1099s (NEC, INT, DIV, B), K-1s\n" +
      "Deductions: mortgage 1098, property tax, charitable receipts, " +
      "state tax paid, medical (if itemizing)\n" +
      "Investments: brokerage cost basis, crypto transaction log\n" +
      "Business: P&L, mileage log, home-office sq ft\n" +
      "Misc: HSA 5498, retirement contributions, dependent SSNs",
  },

  // ─── Reading ────────────────────────────────────────────────────
  {
    title: 'Antifragile — takeaways',
    task_title: 'Antifragile — Taleb',
    body:
      "## Core idea\n\n" +
      "Three categories: fragile (breaks under stress), robust (survives), " +
      "antifragile (gains from disorder). Most systems we build aim for " +
      "robust; we should aim for antifragile.\n\n" +
      "## Stuck with me\n\n" +
      "- *Via negativa*: improve by removing, not adding. Most interventions " +
      "  add complexity that hides risk.\n" +
      "- *Skin in the game*: predictions without consequences are noise.\n" +
      "- *Barbell strategy*: extreme safety on one side, extreme risk on the " +
      "  other, nothing in the middle. The middle is where ruin lives.\n\n" +
      "Skeptical of: the casual way Taleb dismisses anyone who disagrees. " +
      "Some of the swagger feels like substitute for engagement. Worth " +
      "re-reading the chapters on iatrogenics — those land regardless.",
  },
  {
    title: 'DDIA — Chapter 1 notes',
    task_title: 'Designing Data-Intensive Applications — Kleppmann',
    body:
      "## Three concerns: reliability, scalability, maintainability\n\n" +
      "Reliability: tolerating faults (hardware, software, human). Note that " +
      "human errors dominate — design for them.\n\n" +
      "Scalability: not a 1D property. Need to define which load parameter " +
      "and which performance metric. Twitter timeline example: read-heavy " +
      "vs write-heavy decision changes the architecture entirely.\n\n" +
      "Maintainability: operability, simplicity, evolvability. Most expensive " +
      "phase of software is maintenance, not building.\n\n" +
      "Connects to the antifragile idea — maintainability ≈ tolerance for " +
      "future disorder.",
  },
  {
    title: 'Reading list',
    area_name: 'Reading',
    body:
      "On deck (no commitment, just queue). Try to keep this varied — too " +
      "much non-fiction in a row turns my brain to mush.\n\n" +
      "- *The Power Broker* — Caro (long, slow burn)\n" +
      "- *Piranesi* — Susanna Clarke\n" +
      "- *Why We Sleep* — Walker\n" +
      "- *The Body Keeps the Score* — van der Kolk\n" +
      "- *The Beak of the Finch* — Weiner\n" +
      "- *Just Kids* — Patti Smith (memoir)\n\n" +
      "Recommended by friends but not started:\n" +
      "- *Stoner* — John Williams\n" +
      "- *A Pattern Language* — Alexander",
  },

  // ─── Writing ────────────────────────────────────────────────────
  {
    title: 'Essay seeds',
    area_name: 'Writing',
    body:
      "Loose ideas, not yet drafts. Sit with each before committing to write.\n\n" +
      "- The cost of optionality. Why having too many open doors makes it " +
      "  harder to walk through any of them.\n" +
      "- What I got wrong about productivity tools in my twenties.\n" +
      "- The case against weekly reviews. (Or: when ritual becomes theater.)\n" +
      "- A short piece on why my best ideas come on walks, not at the desk. " +
      "  Probably been written 100 times. Worth my version anyway.",
  },
  {
    title: 'One-pager — for investor intros',
    area_name: 'Writing',
    body:
      "Living draft. Currently v3. Hand to anyone offering an intro.\n\n" +
      "**What:** an AI-native productivity tool that erases system maintenance " +
      "for individuals and lets agents read and write alongside them.\n\n" +
      "**Why now:** capture is finally cheap (voice, mobile, ambient). " +
      "Retrieval is finally good (embeddings, LLMs). The bottleneck shifted " +
      "from collecting to organizing — and humans are the worst at that step.\n\n" +
      "**Why us:** *(rewrite this section — too generic right now)*\n\n" +
      "**Traction:** 12 daily active dogfood users. Plan to widen to 100 in " +
      "the next 60 days.\n\n" +
      "**Ask:** intro + feedback. Not raising yet.",
  },
  {
    title: 'Quote stash',
    area_name: 'Writing',
    body:
      "Things worth holding onto. Source-tagged.\n\n" +
      "> Everything should be made as simple as possible, but no simpler.\n" +
      "> — Einstein (paraphrased)\n\n" +
      "> The best way to predict the future is to invent it.\n" +
      "> — Alan Kay\n\n" +
      "> Make it work, make it right, make it fast.\n" +
      "> — Kent Beck\n\n" +
      "> If you wait until you can do everything for everybody, instead of " +
      "> something for somebody, you end up doing nothing for nobody.\n" +
      "> — Malcolm Forbes\n\n" +
      "> What is essential is invisible to the eye.\n" +
      "> — Saint-Exupéry, *The Little Prince*\n\n" +
      "> The cure for boredom is curiosity. There is no cure for curiosity.\n" +
      "> — Dorothy Parker",
  },

  // ─── Network ────────────────────────────────────────────────────
  {
    title: 'Investor friend — context',
    area_name: 'Network',
    body:
      "Met at a conference a couple of years back. Now at a Series-A firm. " +
      "Strong taste on B2B tools.\n\n" +
      "**Last conversation (March):** catch-up coffee. Offered an intro to " +
      "her partner once we're ready — wants a one-pager first.\n\n" +
      "**Open loops:**\n" +
      "- Owed: one-pager for the partner intro (active task)\n" +
      "- Offered: feedback on her firm's new portfolio template (low priority)",
  },
  {
    title: 'Intros — owed and outstanding',
    area_name: 'Network',
    body:
      "**I owe:**\n" +
      "- One-pager → investor friend's partner (draft is in Writing)\n" +
      "- Designer intro → old colleague doing consulting (still thinking " +
      "  who would actually be a fit)\n\n" +
      "**Owed to me (no rush):**\n" +
      "- An ex-colleague at a tools company — friend offered to make the intro\n" +
      "- A founder doing parallel work — heard about them at dinner, name " +
      "  pending from the person who mentioned it",
  },

  // ─── Hobbies ────────────────────────────────────────────────────
  {
    title: 'Chess openings to study',
    area_name: 'Hobbies',
    body:
      "Working through a small repertoire. No ambition beyond enjoyment.\n\n" +
      "**As white**: London System (committed). Avoid theory-heavy mainlines.\n\n" +
      "**As black vs e4**: Caro-Kann (working on the advance variation now).\n" +
      "**As black vs d4**: King's Indian (long-term project).\n\n" +
      "Resources: Lichess studies, Hanging Pawns YouTube, occasional Chessable.",
  },
];
