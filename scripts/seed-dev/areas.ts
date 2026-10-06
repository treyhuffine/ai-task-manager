/**
 * Areas for the shared dev seed. Created first so tasks, notes and stream
 * items can resolve `area_name` to `areaId` against them.
 *
 * Names are the stable reference key. Keep them unique across this file and
 * don't rename casually (tasks.ts and notes.ts reference these names).
 *
 * The dataset is one fictional person's system, written so it can never be
 * mistaken for real data: Maya Okafor, co-owner of Tidewater Coffee (a small
 * roastery), building Fieldnote (an iOS birding app) on the side with coding
 * agents, training for a marathon, renovating a 1924 bungalow, with partner
 * Theo, daughter Ruby (7) and Pepper the dog. About two months of use, so
 * there is history, finished work, and some rot.
 *
 * Modeling principles:
 *  - Flat. No hierarchy, no sub-areas. Sub-aspects (sleep within Health,
 *    wholesale within Tidewater) live in note and task content, not structure.
 *  - Each area passes two tests: durability ("still doing this in 2 years?")
 *    and coherence ("opening it feels like one thing"). Anything failing
 *    coherence is split. Anything failing durability is a task with subtasks
 *    (the marathon is a project inside Health, not an area).
 *  - No catch-alls like "Personal Admin" or "Misc". Taxes go in Money, school
 *    forms in Family. Specific over absorbent.
 *  - Items have a single primary area. Cross-cutting happens through links
 *    between items, not duplicate area assignments.
 *  - All three area states are shown: most are active, Garden Co-op is
 *    inactive (paused this season, kept for the handoff), and Brightline
 *    Analytics is archived (an old job with a few leftovers).
 */
import type { CreateAreaInput } from '../../src/db/types';

export const areas: CreateAreaInput[] = [
  {
    name: 'Tidewater Coffee',
    emoji: '☕',
    description: 'The roastery Luis and I own. Wholesale, subscriptions, the market stall, sourcing, production.',
    userContext:
      'Co-owned with Luis Arroyo. He runs sales, deliveries and the Saturday stall at Harbor Street Market. ' +
      'I run sourcing and production on our 15 kg drum roaster. Wholesale accounts are Little Owl Cafe, ' +
      'Grain & Gather (two locations) and Northside Bakery. About 180 people on the monthly subscription box. ' +
      'Green coffee comes mostly from Meridian Green Coffee. Priya Nair keeps the books.',
    status: 'active',
    sortOrder: 1,
  },
  {
    name: 'Fieldnote',
    emoji: '🐦',
    description: 'My iOS app for logging bird sightings by voice. Side project, built with coding agents.',
    userContext:
      'Nights and weekends. Two codebases: the SwiftUI app and the marketing site. About 40 TestFlight testers, ' +
      'mostly from the Coastal Bird Club. The goal is 1.0 in the App Store while fall migration is still on, ' +
      'because that is when birders log the most. Waitlist lives on the landing page.',
    status: 'active',
    sortOrder: 2,
  },
  {
    name: 'Health',
    emoji: '🏃',
    description: 'Running, recovery, sleep. Training for the Twin Rivers Marathon.',
    userContext:
      'Twin Rivers will be my second marathon (first was 4:11). Goal is 3:45. Long runs are on Tuesdays ' +
      'because Saturdays are market day. Watching a left calf strain. Physio is Jonas at Kinetic Physio. ' +
      'Sleep ring data lives in a note, not in my head.',
    status: 'active',
    sortOrder: 3,
  },
  {
    name: 'Family',
    emoji: '🏡',
    description: 'Theo, Ruby, Pepper, and the people around us.',
    userContext:
      'Theo Brandt teaches chemistry at Jefferson High, so school-year evenings are grading. Ruby is 7, in second grade ' +
      'at Maple Street Elementary, piano on Thursdays, soccer on Saturdays (Theo takes her, I am at the market). ' +
      'Pepper is our five-year-old border collie mix. Theo\'s parents, Ray and Linda, come for Thanksgiving. ' +
      'Ruby turns 8 in December.',
    status: 'active',
    sortOrder: 4,
  },
  {
    name: 'The Bungalow',
    emoji: '🔨',
    description: 'Our 1924 bungalow. Repairs, renovation, the yard.',
    userContext:
      'Bought it three years ago. The big job is the 100A Federal Pacific panel, which Bright Spark Electric ' +
      'is replacing. Kitchen got new cabinets last spring, the backsplash is still bare drywall. Raised beds ' +
      'out back. Every contractor we would call again is in one contacts note.',
    status: 'active',
    sortOrder: 5,
  },
  {
    name: 'Money',
    emoji: '💵',
    description: 'Household and business money admin. Taxes, insurance, the mortgage, Ruby\'s 529.',
    userContext:
      'Tidewater is an LLC taxed as a partnership, so Luis and I each pay quarterly estimates. Priya Nair does ' +
      'the roastery books and our personal return. Theo handles his school retirement plan, I handle the rest.',
    status: 'active',
    sortOrder: 6,
  },
  {
    name: 'Garden Co-op',
    emoji: '🌱',
    description: 'Volunteer treasurer for the Eastside Community Garden. Paused this season.',
    userContext:
      'Stepped back at the end of summer to make room for the marathon and Fieldnote. Joan Pruitt is covering ' +
      'treasurer duties. I still owe her a clean handoff of the books.',
    status: 'inactive',
    sortOrder: 7,
  },
  {
    name: 'Portuguese',
    emoji: '🇵🇹',
    description: 'Learning European Portuguese for Lisbon and Porto next April.',
    userContext:
      'Weekly video lesson with Ana on Wednesday evenings. European pronunciation, not Brazilian. The trip is ' +
      'two weeks in April with Theo and Ruby: Lisbon first, then the train to Porto.',
    status: 'active',
    sortOrder: 8,
  },
  {
    name: 'Brightline Analytics',
    emoji: '📊',
    description: 'My old job. Senior analyst, left last November.',
    userContext: 'Kept only for the few leftovers from leaving. Nothing active here.',
    status: 'archived',
    sortOrder: 9,
  },
];
