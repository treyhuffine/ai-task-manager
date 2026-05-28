/**
 * Areas for the shared dev seed. Created first so tasks/notes can resolve
 * `area_name` → `areaId` against them.
 *
 * Names are the stable reference key — keep them unique across this file
 * and don't rename casually (tasks.ts and notes.ts reference these names).
 *
 * Modeling principles (see design conversations):
 *  - Flat. No hierarchy, no sub-areas. Sub-aspects (Sleep within Health,
 *    Engineering within Flow) live in note/task content, not in structure.
 *  - Each area passes two tests: durability ("still doing this in 2 years?")
 *    and coherence ("opening it feels like one thing"). Anything failing
 *    coherence is split; anything failing durability is a task with subtasks.
 *  - No catch-alls like "Personal Admin" or "Misc." Taxes go in Finance,
 *    school forms in Family, etc. Specific over absorbent.
 *  - Items have a single primary area (single-membership). Cross-cutting
 *    happens via item-to-item relationships, not duplicate area assignments.
 *
 * The set below is a representative model — the active work area (Flow),
 * core life domains (Health, Family, Home, Finance), craft (Reading,
 * Writing), relationships (Network), and joy (Hobbies). A multi-business
 * operator would add one area per active venture alongside Flow.
 */
import type { CreateAreaInput } from '../../src/db/types';

export const areas: CreateAreaInput[] = [
  {
    name: 'AI Assistant',
    emoji: '🤖',
    description: 'Building this app. Architecture, decisions, dogfooding, roadmap.',
    userContext:
      'My primary work focus — the AI-native productivity tool I am building. ' +
      'Engineering, product, and launch work all live here as tasks or notes; ' +
      'they are not separate areas.',
    status: 'active',
    sortOrder: 1,
  },
  {
    name: 'Health',
    emoji: '💪',
    description: 'Sleep, training, nutrition, longevity. The substrate everything else runs on.',
    userContext:
      'Physical and mental health. Sleep stack, training programs, nutrition ' +
      'experiments, doctor visits, and notes on what is working. Sub-aspects ' +
      'like sleep or strength are content within notes — not their own areas.',
    status: 'active',
    sortOrder: 2,
  },
  {
    name: 'Family',
    emoji: '🏡',
    description: 'Partner, kids, parents, household logistics.',
    userContext:
      'People I love and the logistics of being there for them. School pickups, ' +
      'birthdays, family conversations to have, kid activities, parent check-ins.',
    status: 'active',
    sortOrder: 3,
  },
  {
    name: 'Home',
    emoji: '🔧',
    description: 'House, renovations, maintenance, things to fix.',
    userContext:
      'The physical place I live. Repair queue, contractor info, renovation ' +
      'projects (as tasks-with-subtasks), vendor contacts, neighborhood notes.',
    status: 'active',
    sortOrder: 4,
  },
  {
    name: 'Finance',
    emoji: '💰',
    description: 'Money in, money out. Taxes, investments, banking, big decisions.',
    userContext:
      'Personal and business finance combined. Quarterly tax planning, ' +
      'investment thesis notes, banking changes, subscription audits, big ' +
      'purchase decisions. Tax filing is a recurring task, not a separate area.',
    status: 'active',
    sortOrder: 5,
  },
  {
    name: 'Reading',
    emoji: '📚',
    description: 'Books I am reading, takeaways, reading list.',
    userContext:
      'One note per book. Takeaways, quotes, and reflections go in the body. ' +
      'A book becomes a task while actively reading (status=active, ' +
      'completes on finish), then lives on as a note. Reading list is also a note.',
    status: 'active',
    sortOrder: 6,
  },
  {
    name: 'Writing',
    emoji: '✍️',
    description: 'Essays, ideas, drafts, public output.',
    userContext:
      'Things I am writing or want to write. Half-baked ideas live here until ' +
      'they become something. Drafts in progress, published pieces, recurring ' +
      'themes I keep returning to.',
    status: 'active',
    sortOrder: 7,
  },
  {
    name: 'Network',
    emoji: '🤝',
    description: 'People and follow-ups. Conversations, intros, who to reach out to.',
    userContext:
      'Professional and personal relationships. Notes from conversations, ' +
      'follow-up reminders, intros owed and received. One note per person ' +
      'when relationships are active enough to track over time.',
    status: 'active',
    sortOrder: 8,
  },
  {
    name: 'Hobbies',
    emoji: '🎯',
    description: 'Things I do for joy. Not work, not optimization.',
    userContext:
      'Non-work pursuits done because I want to, not because I should. If a ' +
      'hobby becomes serious enough that it needs its own area (active project, ' +
      'frequent items), promote it. Otherwise it lives here.',
    status: 'active',
    sortOrder: 9,
  },
];
