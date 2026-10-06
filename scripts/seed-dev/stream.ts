/**
 * Stream items (quick captures) for the shared dev seed: ten days of Maya
 * throwing things at the inbox, in every lifecycle state the stream supports.
 *
 *   pending     raw and unprocessed: typed fragments, voice transcripts with
 *               the filler words left in, an image capture whose text is the
 *               OCR of a hardware store receipt, and one item that arrived
 *               from an iOS Shortcut
 *   proposed    triage has a suggestion waiting for her answer
 *   promoted    produced a task or note. `promotes_to_task_title` /
 *               `promotes_to_note_title` name the existing item it became,
 *               and that item's `createdAt` falls just after the capture
 *   reviewed    the journal disposition: kept as a thought, nothing owed
 *   dismissed   noise or a duplicate, with `dismissedBy` saying who decided
 *   incubating  parked until `resurfaceAt`, when it returns to pending
 *
 * Internal captures carry no `external*` fields. The two webhook items
 * (`origin: 'webhook'`) carry an `externalSource` and a unique `externalId`,
 * like a real at-least-once delivery would.
 */
import type { CreateStreamInput } from '../../src/db/types';
import { daysAgo, daysFromNow, hoursAgo, minutesAgo } from './time';
import { md } from './tasks';

export interface SeedStreamItem extends Omit<CreateStreamInput, 'status'> {
  status: 'pending' | 'proposed' | 'promoted' | 'reviewed' | 'dismissed' | 'incubating';
  createdAt: string;
  /** For promoted items: the title of the task in tasks.ts it became. */
  promotes_to_task_title?: string;
  /** For promoted items: the title of the note in notes.ts it became. */
  promotes_to_note_title?: string;
}

export const stream: SeedStreamItem[] = [
  // ─── Pending ────────────────────────────────────────────────────
  {
    rawText:
      "um, Ruby asked if Pepper can be on the birthday invitations, like a photo of her in a party hat. which is honestly cute. " +
      'also the rink said they need the headcount two weeks out, so, the invite list question is kind of urgent now',
    source: 'capture',
    media: 'voice',
    origin: 'internal',
    status: 'pending',
    createdAt: minutesAgo(40),
  },
  {
    rawText: 'Ruby needs a costume for the class harvest parade?? check the folder',
    source: 'capture',
    media: 'text',
    origin: 'internal',
    status: 'pending',
    createdAt: hoursAgo(3),
  },
  {
    rawText: md`
      HARBOR HARDWARE & SUPPLY
      412 FRONT ST
      SALE   REG 02   CASHIER: DEB
      ROOF FLASHING TAPE 4IN X 25FT   1 @ 18.99    18.99
      ROOF CEMENT 10.1 OZ             2 @ 7.49     14.98
      CAULK GUN DRIPLESS              1 @ 9.99      9.99
      SUBTOTAL                                     43.96
      TAX 8.0%                                      3.52
      TOTAL                                        47.48
      VISA ************4471
      KEEP RECEIPT FOR RETURNS. THANK YOU!
    `,
    source: 'capture',
    media: 'image',
    origin: 'internal',
    status: 'pending',
    createdAt: hoursAgo(20),
  },
  {
    rawText:
      "fieldnote: what if the confirm sheet showed a bird photo next to the name. would catch 'coopers talk' type misses instantly",
    source: 'capture',
    media: 'text',
    origin: 'internal',
    status: 'pending',
    createdAt: hoursAgo(26),
  },
  {
    rawText:
      'remind me to ask Dana if the new panel can, um, have room for an EV charger circuit later. not now, later. ' +
      "so we don't redo the whole thing in two years",
    source: 'capture',
    media: 'voice',
    origin: 'internal',
    status: 'pending',
    createdAt: hoursAgo(31),
  },
  {
    rawText: 'calf felt fine on the easy 6 this morning. 2/10. the 18 might be on',
    source: 'capture',
    media: 'text',
    origin: 'internal',
    status: 'pending',
    createdAt: daysAgo(1, 6, 10),
  },
  {
    rawText: 'luis says the check engine light is back on the van. mechanic thursday? he needs it for the G&G run',
    source: 'webhook',
    media: 'voice',
    origin: 'webhook',
    externalSource: 'shortcuts',
    externalId: 'shortcut-capture-7f3a9c21',
    externalPayload: JSON.stringify({
      shortcut: 'Capture to Ri',
      input: 'dictation',
      text: 'luis says the check engine light is back on the van. mechanic thursday? he needs it for the G&G run',
      device: "Maya's iPhone",
    }),
    status: 'pending',
    createdAt: daysAgo(1, 17, 45),
  },

  // ─── Proposed ───────────────────────────────────────────────────
  {
    rawText:
      'holiday gift box for the subscription? 3 coffees + a mug, $65. sell it at the market stall too. ask Juniper if the new bags are ready in time',
    source: 'capture',
    media: 'text',
    origin: 'internal',
    status: 'proposed',
    createdAt: daysAgo(1, 21, 0),
  },
  {
    rawText:
      "Theo says his mom can't do gluten anymore, so the Thanksgiving stuffing, um, figure that out. " +
      "and they want to come Tuesday not Wednesday. so that's five nights. hmm",
    source: 'capture',
    media: 'voice',
    origin: 'internal',
    status: 'proposed',
    createdAt: daysAgo(2, 7, 45),
  },
  {
    rawText: 'testers keep asking for dark mode for dawn birding. a white screen at 5am is a flashbang',
    source: 'capture',
    media: 'text',
    origin: 'internal',
    status: 'proposed',
    createdAt: daysAgo(3, 22, 15),
  },

  // ─── Promoted ───────────────────────────────────────────────────
  {
    rawText: 'calf is tight again after the 16, like the lower part, left side. need to actually book Jonas this time',
    source: 'capture',
    media: 'voice',
    origin: 'internal',
    status: 'promoted',
    createdAt: daysAgo(5, 11, 0),
    promotes_to_task_title: 'Book physio for calf strain',
  },
  {
    rawText: 'apple dev account renewal email, expires next week. DO NOT let testflight die',
    source: 'capture',
    media: 'text',
    origin: 'internal',
    status: 'promoted',
    createdAt: daysAgo(3, 9, 30),
    promotes_to_task_title: 'Renew the Apple developer membership',
  },
  {
    rawText: md`
      MAPLE STREET ELEMENTARY
      FIELD TRIP PERMISSION FORM
      Grade 2, Room 14 (Ms. Adeyemi)
      Destination: Coastal Aquarium
      Depart 9:00 AM / Return 2:15 PM
      Cost: $12.00 (cash or check to MSE PTA)
      Please return this form and payment within 3 school days.
      Student name: Ruby Okafor-Brandt
      Parent/guardian signature: ______________
      [ ] I can chaperone   [ ] I cannot chaperone
      Lunch: [ ] school sack lunch   [ ] packing from home
    `,
    source: 'capture',
    media: 'image',
    origin: 'internal',
    status: 'promoted',
    createdAt: daysAgo(2, 16, 10),
    promotes_to_task_title: "Ruby's field trip permission slip",
  },
  {
    rawText:
      'okay notes from the Luis call. eight percent in January on wholesale, everybody except, well, we did not decide Northside. ' +
      'Grain and Gather keeps their discount. letter goes out early December. retail at the market is still open. ' +
      "I'll put the numbers in the price sheet",
    source: 'capture',
    media: 'voice',
    origin: 'internal',
    status: 'promoted',
    createdAt: daysAgo(6, 15, 50),
    promotes_to_note_title: 'Call with Luis about wholesale pricing',
  },
  {
    rawText: 'G&G wants holiday blend samples before their menu meeting. 2 bags. Rina said by next week',
    source: 'capture',
    media: 'text',
    origin: 'internal',
    status: 'promoted',
    createdAt: daysAgo(6, 9, 0),
    promotes_to_task_title: 'Get the holiday blend sample to Grain & Gather',
  },
  {
    rawText:
      "pasting tester replies so they don't rot in my inbox. Gary: lost my whole reservoir morning, 31 birds. " +
      'Ines: two sightings vanished after I put my phone in my pocket. Dale: please do not make this a subscription. ' +
      "Ruth: voice entry is the whole reason I'd use this. 27 replies total, sort them later",
    source: 'chat',
    media: 'text',
    origin: 'internal',
    status: 'promoted',
    createdAt: daysAgo(10, 8, 0),
    promotes_to_note_title: 'TestFlight feedback, round 2',
  },

  // ─── Reviewed ───────────────────────────────────────────────────
  {
    rawText:
      'Good day. Wholesale form shipped, no more Monday fixes for Luis. Ruby read me a whole chapter book at bedtime. ' +
      'Remember days like this when the roaster breaks.',
    source: 'capture',
    media: 'text',
    origin: 'internal',
    status: 'reviewed',
    createdAt: daysAgo(4, 22, 40),
  },
  {
    rawText:
      'sixteen done. two twenty-four and change. the calf grabbed on the hill at thirteen but it let go. last mile under nine. ' +
      'honestly the river at that hour is the best part of my week',
    source: 'capture',
    media: 'voice',
    origin: 'internal',
    status: 'reviewed',
    createdAt: daysAgo(7, 11, 30),
  },
  {
    rawText:
      "Highlight from What It's Like to Be a Bird (David Allen Sibley): crows recognize individual human faces and remember " +
      'people who threatened them for years. My note: Ruby now waves at every crow, just in case.',
    source: 'webhook',
    media: 'text',
    origin: 'webhook',
    externalSource: 'readwise',
    externalId: 'rw-highlight-58213907',
    externalPayload: JSON.stringify({
      book: "What It's Like to Be a Bird",
      author: 'David Allen Sibley',
      highlight_id: 58213907,
      location: 1184,
    }),
    status: 'reviewed',
    createdAt: daysAgo(8, 21, 15),
  },

  // ─── Dismissed ──────────────────────────────────────────────────
  {
    rawText: 'oat milk',
    source: 'capture',
    media: 'text',
    origin: 'internal',
    status: 'dismissed',
    dismissedBy: 'user',
    createdAt: daysAgo(9, 13, 0),
  },
  {
    rawText: 'test',
    source: 'capture',
    media: 'text',
    origin: 'internal',
    status: 'dismissed',
    dismissedBy: 'user',
    createdAt: daysAgo(10, 7, 5),
  },
  {
    rawText: 'call dana re panel!!',
    source: 'capture',
    media: 'text',
    origin: 'internal',
    status: 'dismissed',
    dismissedBy: 'ai',
    createdAt: daysAgo(3, 8, 50),
  },

  // ─── Incubating ─────────────────────────────────────────────────
  {
    rawText:
      'fieldnote idea: a year-list recap card in December, shareable. like a year in review but for birds. after 1.0 obviously',
    source: 'capture',
    media: 'text',
    origin: 'internal',
    status: 'incubating',
    resurfaceAt: daysFromNow(45, 9),
    createdAt: daysAgo(8, 20, 0),
  },
  {
    rawText:
      'what if Tidewater did a roasting class. like a Saturday afternoon after market, six people, eighty-five each. ' +
      "after the holidays when it's dead",
    source: 'capture',
    media: 'voice',
    origin: 'internal',
    status: 'incubating',
    resurfaceAt: daysFromNow(90, 9),
    createdAt: daysAgo(10, 7, 30),
  },
];
