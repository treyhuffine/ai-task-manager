/**
 * Notes for the shared dev seed. Optionally attach a note to an area
 * (`area_name`), a task (`task_title`) or a seeded agent (`agent_slug`). The
 * runner resolves all three after areas, tasks and agents exist.
 *
 * Titles are unique and stable: task bodies link here with `{{note:Title}}`,
 * stream.ts points promoted captures at notes by title, and notes link to
 * tasks and each other the same way. `{{file:name}}` embeds one of the
 * generated attachment files.
 *
 * The set below shows the range of a real system two months in:
 *   - Reference notes (contractor contacts, wholesale accounts, Ruby's school
 *     info, where the money lives, paint colors)
 *   - Decision notes (on-device transcription, the panel quotes)
 *   - Meeting notes (the call with Luis about wholesale pricing)
 *   - Working documents pinned to a task (launch checklist, job post,
 *     inspection notes, gift ideas, the treasurer handoff)
 *   - Logs and plans (training plan, calf strain log, roast profile, sleep)
 *   - A recipe, book notes, bookmarks with a `url`, and a journal-style
 *     weekly review
 *   - Lengths from one line to long documents, three archived notes, and a
 *     few with no area at all
 *
 * No tags. No folders. Cross-cutting happens through the area, the task
 * linkage, and links inside bodies.
 */
import type { CreateNoteInput } from '../../src/db/types';
import { daysAgo, hoursAgo } from './time';
import { md, type AgentSlug } from './tasks';

export type SeedNote = Omit<CreateNoteInput, 'areaId' | 'taskId' | 'workspaceId'> & {
  area_name?: string;
  task_title?: string;
  agent_slug?: AgentSlug;
};

export const notes: SeedNote[] = [
  // ─── Tidewater Coffee ───────────────────────────────────────────
  {
    title: 'Green coffee buying notes: 2026 harvest',
    area_name: 'Tidewater Coffee',
    createdAt: daysAgo(9, 16, 0),
    body: md`
      Meridian's fall offer list, cupped blind with Luis. Both our scores, averaged. Anything under 84 doesn't make the menu unless it's a blend base.

      ## Ethiopia
      - **Guji, Hambela natural** (lot 2207): **88.5**. Blueberry, jasmine, a little boozy as it cools. $9.40/lb. Yes, 10 bags. This is the subscription hero.
      - **Yirgacheffe, Kochere washed**: **87**. Lemon, black tea, very clean. $8.90/lb. Maybe, if the budget stretches.
      - **Sidama natural**: **84.5**. Muddy next to the Guji. Pass.

      ## Colombia
      - **Huila, Pitalito washed**: **86**. Red apple, panela. $7.25/lb. Yes, 8 bags. Sample 2 tasted papery on the cool down, so re-cup before signing.
      - **Nariño, La Florida**: **85.5**. Juicy, but the whole lot is only 6 bags. Ask if we can take all six.

      ## Brazil
      - **Cerrado Mineiro, pulped natural**: **83.5**. Chocolate, roasted nut, low acid. Under the line on its own but it's the espresso base. $5.10/lb. 12 bags.
      - **Mogiana natural**: **82**. Flat. Pass.

      ## Central America
      - **Guatemala, Huehuetenango**: **86.5**. Stone fruit, cocoa. $7.80/lb. 6 bags.
      - **Honduras, Santa Bárbara**: **85**. Fine, nothing special. Backup if the Guatemala sells out.

      ## Decaf
      - **Mexico, Mountain Water process**: **84**. Cleanest decaf we've ever cupped. $7.60/lb. Three bags, only if decaf joins the subscription.

      ## Notes to self
      - Arrival dates are "estimated" for a reason. Last year the Guatemala landed five weeks late.
      - Ask Meridian about splitting freight with the roastery across town again. Saved $640 last time.
    `,
  },
  {
    title: 'Roast profile notes: Guji natural',
    area_name: 'Tidewater Coffee',
    agent_slug: 'roast-lab',
    createdAt: daysAgo(22, 14, 0),
    body: md`
      Profile for the Hambela natural on the 15 kg. Dense, small bean. Scorches if you push the front end.

      {{file:roast-curve-guji.png}}

      That's batch 214, the last v3 roast: a full 15 kg charge, dropped at 412F at 10:52, 19.4% development. It cupped roasty. v4 fixes it.

      ## Current profile (v4)
      - Charge: 12 kg at 410F, gas 60%. A full 15 kg drags the turning point
      - Turning point around 1:30 at 180F
      - Gas to 80% at 3:00, back to 55% at dry end (about 6:00)
      - First crack: 8:30 to 8:45 at 388F
      - Drop: 10:15 to 10:30 at 404F
      - Development: about 16 to 17%

      ## What changed from v3
      Took 8 degrees off the drop, cut the charge to 12 kg, and pulled gas earlier so the rate of rise doesn't flick at first crack.

      ## Cupping
      - v3 (batch 214): 85. Roasty, blueberry buried.
      - v4: 88. Blueberry and jasmine both there, sweet finish.

      Charts come from {{task:Chart roast curves from Artisan logs}}. The flick on batch 214 is right after first crack.
    `,
  },
  {
    title: 'Wholesale price sheet 2026',
    area_name: 'Tidewater Coffee',
    agent_slug: 'tidewater-shop',
    createdAt: daysAgo(48, 15, 0),
    body: md`
      Per pound, in 5 lb bags. 12 oz retail price is for cafes reselling on their shelf. Net 15. Free delivery over 20 lb inside the loop.

      ## Year-round
      - **Harbor House Blend** (espresso): $11.75/lb, retail 12 oz $9.50
      - **Morning Tide** (drip): $11.25/lb, retail 12 oz $9.00
      - **Colombia Huila**: $13.50/lb, retail 12 oz $11.00
      - **Decaf Mexico**: $13.75/lb, retail 12 oz $11.25

      ## Seasonal
      - **Ethiopia Guji natural**: $16.50/lb, retail 12 oz $13.00
      - **Guatemala Huehuetenango**: $14.25/lb, retail 12 oz $11.50
      - **Winter Solstice** (holiday blend): $14.00/lb, retail 12 oz $11.50

      ## Volume
      - 50+ lb a week: 5% off
      - 100+ lb a week: 8% off (only Grain & Gather right now)

      Prices change in January. Don't send this sheet to new accounts once the letter goes out.
    `,
  },
  {
    title: 'Call with Luis about wholesale pricing',
    area_name: 'Tidewater Coffee',
    createdAt: daysAgo(6, 16, 10),
    body: md`
      Phone, 25 minutes. Luis driving back from the Grain & Gather delivery.

      ## Decided
      - Raise wholesale 8% in January. Green is up about 15% on the new contracts and we're eating the rest.
      - 30 days notice to accounts, so the letter goes out early December.
      - Grain & Gather keeps the 8% volume discount. Squeezing our biggest account is how you lose it.

      ## Not decided
      - Northside Bakery. Gus will push back, he always does. Luis wants to hold their Morning Tide price and raise the rest. I think that's how everyone ends up with a special price.
      - Whether retail 12 oz at the market goes up at the same time. The regulars notice.

      ## Follow-ups
      - [ ] Me: new numbers as a draft column in {{note:Wholesale price sheet 2026}}
      - [ ] Luis: sound out Sam at Little Owl, informally
      - [ ] Both: price letter drafted before Thanksgiving
    `,
  },
  {
    title: 'Wholesale accounts',
    area_name: 'Tidewater Coffee',
    createdAt: daysAgo(55, 14, 0),
    body: md`
      Who they are, what they order, how they like it.

      ## Little Owl Cafe
      - Sam Torres (owner), 555-0124
      - Standing: 36 lb a week of Harbor House (was 30), 10 lb Morning Tide
      - Delivery before 7am, back door code 2580
      - Pays on time, every time

      ## Grain & Gather
      - Rina Patel (ops), 555-0131. Two locations, a third opening in spring
      - Standing: about 85 lb a week across four coffees, 8% volume discount
      - Wants invoices split by location
      - Pitched a canned cold brew collab. Parked, the canning minimum is 2,000 cans

      ## Northside Bakery
      - Gus Leblanc, 555-0145
      - Standing: 20 lb a week Morning Tide, plus 24 retail bags every two weeks
      - Slow payer. Net 15 means net 30 to Gus. Friendly about it, still slow
      - Makes dog-shaped birthday cakes. Remember for Ruby
    `,
  },
  {
    title: 'Last health inspection notes',
    area_name: 'Tidewater Coffee',
    task_title: 'Prep for health inspection',
    createdAt: daysAgo(20, 11, 30),
    body: md`
      From the last county inspection, about 14 months ago. Inspector Gómez. Passed with two minor notes:

      - Hand sink was being used to rinse scoops. "Hand sink is for hands." We put up a sign and bought a prep basin.
      - Two green sacks stored directly on the floor. Pallets, 6 inches up.

      She also asked to see:
      - The pest control log
      - Sanitizer test strips and their log
      - The allergen line on retail bags (the seasonal hazelnut blend we stopped doing still haunts the labels)
      - How a bag traces back to its roast batch. The new labels fix this with a printed lot number
    `,
  },
  {
    title: 'Production roaster job post',
    area_name: 'Tidewater Coffee',
    task_title: 'Hire a part-time production roaster',
    createdAt: daysAgo(18, 20, 0),
    body: md`
      **Part-time Production Roaster, Tidewater Coffee**

      We're a two-person roastery roasting about 900 lb a week for cafes, a monthly subscription and a Saturday market stall. We need a second roaster for Tuesday and Thursday production days.

      **The job**
      - Roast on a 15 kg drum roaster to set profiles, logging every batch
      - Weigh, bag, label and stack orders for delivery
      - Keep the roastery clean enough to pass an inspection on any given day
      - Cup with us on Fridays (optional, encouraged)

      **You**
      - Have roasted before, any size, or have run a busy espresso bar and want to learn
      - Can lift and stack 70 lb sacks safely, over and over
      - Show up at 6am and like it, or at least don't mind it

      **Pay and hours:** $22 to $25 an hour depending on experience, 16 to 20 hours a week, free coffee forever.

      To apply, send a few lines about yourself and the last coffee you were excited about.
    `,
  },
  {
    title: "Book notes: The Coffee Roaster's Companion",
    area_name: 'Tidewater Coffee',
    createdAt: daysAgo(34, 21, 30),
    body: md`
      Scott Rao. Re-reading with the 15 kg in mind. My takeaways, in my words.

      - A steadily falling rate of rise matters more than hitting exact times. A flick or a crash around first crack shows up in the cup as flat or baked.
      - Most of a roast's fate is decided early. Get enough energy in during the first few minutes or you spend the rest of the roast chasing.
      - Development time ratio is a guide, not a target. Dense, high-grown coffees can take more.
      - Profiles don't scale. Our 12 kg profiles don't work for 6 kg half batches. Write separate ones.

      Try next: a shorter drying phase on the Huila, to see if the papery note goes away.
    `,
  },
  {
    title: 'Old market stall layout',
    area_name: 'Tidewater Coffee',
    status: 'archived',
    createdAt: daysAgo(56, 13, 0),
    body:
      'First-summer layout: one table along the front, grinder on the left, pour-overs in the middle. ' +
      'Replaced when we got the 10x10 tent and moved brewing to the back table.',
  },

  // ─── Fieldnote ──────────────────────────────────────────────────
  {
    title: 'Fieldnote 1.0 launch checklist',
    area_name: 'Fieldnote',
    task_title: 'Fieldnote 1.0 launch',
    createdAt: daysAgo(44, 22, 0),
    body: md`
      Everything between here and "live in the App Store". Big items have their own tasks.

      ## Build
      - [x] eBird CSV export
      - [x] Regional species list (Clements taxonomy, latest update)
      - [x] Crash reporting wired up
      - [ ] Offline sync fix ({{task:Fix offline sync dropping sightings}})
      - [ ] On-device voice transcription
      - [ ] Dark mode pass. Dawn birding is real, testers keep asking
      - [ ] Debug menu out of release builds
      - [ ] Bump to 1.0 (1)

      ## App Store
      - [ ] Privacy policy URL ({{task:Write the privacy policy}})
      - [ ] Privacy labels: location yes, audio not collected, crash data anonymous
      - [ ] Screenshots, 6.7 inch and 5.5 inch
      - [ ] Subtitle, keywords, description
      - [ ] Support URL (the landing page contact form is fine)
      - [ ] Age rating questionnaire
      - [ ] Submit ({{task:Submit Fieldnote 1.0 to App Store review}})

      ## Launch
      - [x] Landing page on a preview URL
      - [ ] Waitlist email drafted
      - [ ] Coastal Bird Club newsletter post (their deadline is the 1st of the month)
      - [ ] Thank-you email to the 40 testers, with a free year
      - [ ] Message the r/birding mods before posting so it isn't removed as spam

      ## After launch
      - Read crash reports daily for a week
      - Ship a first update within two weeks no matter what, even a small one
    `,
  },
  {
    title: 'TestFlight feedback, round 2',
    area_name: 'Fieldnote',
    createdAt: daysAgo(10, 8, 30),
    body: md`
      Build 0.9.3, 40 testers, two weeks. 27 replied. Quotes copied as written, grouped.

      ## Sync and lost data (the big one)
      - "Lost my whole reservoir morning. 31 birds. I'm not mad, but I am sad." (Gary)
      - "Two sightings vanished after I put my phone in my pocket." (Ines)
      - "Is there a way to see what hasn't uploaded yet?" (Paul)

      All of that is {{task:Fix offline sync dropping sightings}}.

      ## Voice
      - "Voice entry is the whole reason I'd use this over eBird directly." (Ruth)
      - "It wrote 'coopers talk'. Twice."
      - "Would love to say 'same as last' for a flock I keep re-counting."

      ## Pricing
      - "Please don't make this a subscription. I have nine subscriptions." (Dale)
      - "Would pay $10 once without thinking."
      - "If it synced to eBird automatically I'd pay yearly."

      ## Small stuff
      - Dark mode for dawn birding (five people)
      - Bigger tap targets for gloves
      - Map pin drifts about 30 m in the woods (probably GPS, not us)
      - "The icon looks like every other bird app icon"
    `,
  },
  {
    title: 'Fieldnote onboarding flow',
    area_name: 'Fieldnote',
    agent_slug: 'fieldnote-ios',
    createdAt: daysAgo(24, 21, 0),
    body: md`
      Three screens, then straight to the map. No account until you've logged a first bird.

      {{file:fieldnote-onboarding.png}}

      1. **Hear a bird? Just talk.** Say what you saw and where. Fieldnote does the typing.
      2. **Works offline.** Log on the trail with no signal. It syncs when you're back.
      3. **Your life list.** Every species, every place, searchable by voice.

      eBird export lives in settings, not onboarding. The testers who care about it find it.

      Permissions, one at a time and only when needed:
      - Location: asked on the first sighting, not at launch
      - Microphone: asked on the first hold-to-talk
      - Notifications: never asked in 1.0

      ## Decisions
      - Sign in with Apple only. No passwords to support.
      - Skip on every screen. Testers who skipped logged birds just as fast.
      - Region comes from location silently, with a "wrong region?" link in settings.
    `,
  },
  {
    title: 'Fieldnote sync architecture',
    area_name: 'Fieldnote',
    agent_slug: 'fieldnote-ios',
    createdAt: daysAgo(4, 23, 0),
    body: md`
      How a sighting gets from the phone to the server. Written down because the bug made it clear nobody (me) had the full picture.

      ## Before the fix
      1. Sighting saved to sightings.json and added to the pending queue, which only lived in memory (pending.json was never actually written)
      2. Sync worker pops sightings and uploads them
      3. Success: nothing to do, they were already popped. Failure: pushed back onto the queue
      4. If the app is suspended or killed mid-upload, neither branch runs. The sightings are gone

      ## Now (on the branch, in review)
      1. The pending queue is saved to pending.json after every change
      2. A sighting leaves the queue only after a 201
      3. A failed upload stays queued for the next flush, and only one flush runs at a time

      ## Next
      1. A client id on every sighting. The server already dedupes on user and client id, so a double send becomes harmless
      2. Uploads on a background session, so locking the phone doesn't cancel them

      ## Decisions
      - No iCloud sync. We need the server copy for eBird export and a web view later.
      - One sighting per request for now. Easier to make safe. Batch later if the marsh's one bar makes it slow.
      - sightings.json keeps its format. Every tester's data lives in it.

      Work tracked in {{task:Fix offline sync dropping sightings}}.
    `,
  },
  {
    title: 'Decision: on-device transcription, not a server',
    area_name: 'Fieldnote',
    createdAt: daysAgo(27, 22, 0),
    body: md`
      **Decided:** speech recognition runs on the phone. No audio ever leaves the device.

      Why:
      - Birders are out with one bar or none. A server round trip defeats the point of the app.
      - The privacy policy gets simpler. We never hold anyone's audio.
      - No per-minute transcription bill on what might be a $5 app.

      Cost:
      - Species names are worse out of the box. Species hints fix most of it, but iOS caps them at about 100 a request, so they have to be regional and seasonal.
      - Older phones are slow. 1.0 requires iOS 17 anyway.

      Revisit if accuracy on the confirm sheet stays under 90% after the vocabulary work.
    `,
  },
  {
    title: 'eBird spreadsheet upload format',
    area_name: 'Fieldnote',
    url: 'https://support.ebird.org/en/support/solutions/articles/48000907878-upload-spreadsheet-data-to-ebird',
    createdAt: daysAgo(31, 22, 30),
    body: 'The CSV layout eBird accepts for spreadsheet uploads. Column order matters and there is no header row. This is what the export targets.',
  },
  {
    title: 'Fieldnote name ideas',
    area_name: 'Fieldnote',
    status: 'archived',
    createdAt: daysAgo(57, 22, 0),
    body: md`
      Picked Fieldnote. Keeping the list for the record.

      - Fieldnote (winner, and the domain was free)
      - Tally
      - Birdsay
      - Heard It
      - Lister
      - Morning Count (too long)
    `,
  },

  // ─── Health ─────────────────────────────────────────────────────
  {
    title: 'Marathon training plan (16 weeks)',
    area_name: 'Health',
    createdAt: daysAgo(56, 6, 45),
    body: md`
      Twin Rivers Marathon. Goal 3:45 (8:35 a mile). Loosely based on an intermediate plan, cut to four run days because Saturday is market day.

      Long runs on Tuesdays. Easy runs at 9:45 or slower, no exceptions, even when it feels good.

      ## The plan
      - **Week 1:** 22 mi, long 8. Done
      - **Week 2:** 24 mi, long 9. Done
      - **Week 3:** 26 mi, long 10. Done
      - **Week 4:** 22 mi, long 8 (cutback). Done
      - **Week 5:** 28 mi, long 12. Done
      - **Week 6:** 30 mi, long 13. Done, brutally hot
      - **Week 7:** 32 mi, long 14. Done
      - **Week 8:** 26 mi, long 10 (cutback). Done
      - **Week 9:** 34 mi, long 15. Done, first calf twinge
      - **Week 10:** 34 mi, long 15 again (calf). Done
      - **Week 11:** 36 mi, long 16. Done, 2:24:40
      - **Week 12:** 38 mi, long 18. **This week**
      - **Week 13:** 40 mi, long 20. Peak
      - **Week 14:** 32 mi, long 14. Taper
      - **Week 15:** 26 mi, long 10. Taper
      - **Week 16:** race week. 3, 3, 2 shakeout, then 26.2

      ## Week 11 long run splits
      {{file:long-run-splits.csv}}

      Steady around 9:00 until the hill at 13, where the calf tightened and I gave up 20 seconds a mile for two miles. Back under 9:00 for the last one.

      ## Paces
      - Easy: 9:45 to 10:15
      - Long: 8:55 to 9:15
      - Marathon pace: 8:30 to 8:40
      - Tempo: 7:55

      ## Fueling
      - Gel every 35 minutes from minute 40. Plain, not caffeinated (week 9 lesson)
      - About 500 ml of water an hour, more if it's warm
      - Breakfast 3 hours before: bagel, peanut butter, banana, coffee (obviously)
    `,
  },
  {
    title: 'Calf strain log',
    area_name: 'Health',
    createdAt: daysAgo(20, 8, 0),
    body: md`
      Left calf, lower and on the inside. Pain out of 10, after runs and the next morning.

      - **Week 9 long run:** twinge at mile 13 of 15. 3 after, 1 the next morning.
      - **Week 10:** easy runs fine. Long run tight from mile 11. 4 after.
      - **Week 11 long run:** 16 miles, tight on the hill at 13 again. 3 after. Foam roller, calf raises.
      - **This week:** 2 on the easy 6. Best it has felt in three weeks.

      ## Rules I'm holding myself to
      - Above 4 during a run: stop and walk home
      - Calf raises three times a week, not "when I remember"
      - See Jonas before the 20 miler, not after ({{task:Book physio for calf strain}})
    `,
  },
  {
    title: 'Sleep: what the numbers say',
    area_name: 'Health',
    createdAt: daysAgo(15, 7, 0),
    body: md`
      Two months of the sleep ring. Averages, not vibes.

      - Average 6h 52m. Goal is 7h 30m. Not close.
      - Nights I code past 10:30: score 71. Nights I don't: 82.
      - Long run days are the best sleep of the week.
      - One glass of wine at dinner costs about 8 points. Even one.
    `,
  },

  // ─── Family ─────────────────────────────────────────────────────
  {
    title: "Ruby's favorite banana bread",
    area_name: 'Family',
    createdAt: daysAgo(41, 10, 30),
    body: md`
      The one she asks for every Sunday. One loaf. The bananas should be riper than you think, nearly black.

      ## Ingredients
      - 3 very ripe bananas
      - 1/3 cup melted butter
      - 1/2 cup brown sugar (we use a little less)
      - 1 egg
      - 1 tsp vanilla
      - 1 tsp baking soda
      - Pinch of salt
      - 1 1/2 cups flour
      - 1/2 cup chocolate chips (Ruby's non-negotiable)

      ## Steps
      1. Oven to 350F, butter the loaf pan
      2. Mash the bananas in the big bowl, stir in the melted butter
      3. Mix in sugar, egg and vanilla
      4. Sprinkle baking soda and salt over, stir, then fold in the flour
      5. Chips in last. Ruby does this part, so expect extra chips on top
      6. 55 to 60 minutes, until a toothpick comes out clean. Cool 10 minutes before Pepper starts begging
    `,
  },
  {
    title: "Ruby's school info",
    area_name: 'Family',
    createdAt: daysAgo(55, 20, 0),
    body: md`
      - **School:** Maple Street Elementary, 2nd grade, Room 14
      - **Teacher:** Ms. Adeyemi. Message her through the school app, she answers the same day
      - **Drop-off:** 8:05 to 8:20. **Pickup:** 2:50, early release Wednesdays at 1:20
      - **Lunch account:** top up when it drops under $10
      - **After school:** piano Thursdays at 4 with Mrs. Halvorsen, soccer Saturdays at 9 (Theo takes her)
      - **Best friends:** Nora, Asha (Priya's daughter), and "the twins"
      - **Allergies:** none. Hates mushrooms, will tell you so.
    `,
  },
  {
    title: 'Birthday gift ideas for Ruby',
    area_name: 'Family',
    task_title: "Ruby's 8th birthday party",
    createdAt: daysAgo(10, 21, 0),
    body: md`
      Running list. Theo adds to it too.

      - Real binoculars, kid size (she keeps borrowing mine)
      - Her own field guide, the one with the big pictures
      - Roller skates, if we do the rink
      - An art kit with the good markers, not the washable ones
      - Kid apron and a baking day with me
      - From Pepper: a matching bandana, obviously
    `,
  },

  // ─── The Bungalow ───────────────────────────────────────────────
  {
    title: 'Bungalow contractor contacts',
    area_name: 'The Bungalow',
    createdAt: daysAgo(54, 19, 0),
    body: md`
      Everyone who has worked on the house that I'd call again, plus one I wouldn't.

      ## Electrical
      - **Dana Whitfield**, Bright Spark Electric, 555-0172. Doing the panel. Fast, honest, books about three weeks out.

      ## Roofing
      - **Hector Salas**, Salas Roofing, 555-0119. Quoted the skylight. Text, don't call.

      ## Plumbing
      - **Mei Chen**, Chen Plumbing & Drain, 555-0136. Replaced the main shutoff. $145 call-out.

      ## Tile
      - **Andre Baptiste**, 555-0187. Did the bathroom floor at Gil's next door. Booked about four weeks out.

      ## Handyman
      - **Walt**, 555-0154. Cash only. Great for small stuff. Nothing structural.

      ## Gutters
      - **Clearflow Gutters**, 555-0161. $185 for the whole house, for the year I give up on doing it myself.

      ## Trees
      - **Fern Lindgren**, Treehouse Arbor Care, 555-0193. Looked at the big maple. Healthy, prune in late winter.

      ## Not again
      - Ruiz Electric. Wanted to skip the permit on a panel swap.
    `,
  },
  {
    title: 'Panel upgrade quotes',
    area_name: 'The Bungalow',
    createdAt: daysAgo(16, 12, 30),
    body: md`
      Replacing the 100A Federal Pacific panel with 200A. The insurance company flagged it, and the kitchen needs two new circuits anyway.

      ## Quotes
      - **Bright Spark Electric (Dana Whitfield):** $6,850. Permit, utility coordination and two kitchen circuits included. Three weeks out.
      - **Volt Bros:** $8,200. Very thorough, very expensive.
      - **Ruiz Electric:** $7,400, no permit in the quote, and "we usually don't bother" for a panel. No.

      ## Decision
      Dana. The cheapest one doing it properly, and she answered every question in writing.

      Next step: {{task:Call Dana about the panel upgrade}}
    `,
  },
  {
    title: 'Paint colors we used',
    area_name: 'The Bungalow',
    createdAt: daysAgo(53, 18, 0),
    body: md`
      For touch-ups. Cans are on the garage shelf, labeled.

      - Living and dining: Benjamin Moore Pale Oak, eggshell
      - Kitchen: Sherwin-Williams Alabaster, satin
      - Ruby's room: Benjamin Moore Breath of Fresh Air. She picked it. It is very blue
      - Front door: Benjamin Moore Hale Navy, exterior semi-gloss
      - All trim: Alabaster, semi-gloss
    `,
  },

  // ─── Money ──────────────────────────────────────────────────────
  {
    title: 'Where the money lives',
    area_name: 'Money',
    agent_slug: 'household',
    createdAt: daysAgo(52, 21, 0),
    body: md`
      Not passwords. Just which account does what, so Theo can find things if I'm unreachable.

      - **Joint checking** (credit union): paychecks in, mortgage and bills out
      - **Joint savings:** emergency fund. Target six months of expenses, currently about four
      - **Tidewater business checking:** roastery only. Priya has view access
      - **Tax savings:** 30% of every roastery draw goes here for the quarterly estimates
      - **Ruby's 529:** $100 a month on autopay (should be $150, there's a task)
      - **Mortgage:** the servicer changed twice. The current one is on the fridge magnet
      - **Home insurance:** Rosa Delgado at Harbor Mutual, 555-0142
      - **Bookkeeper:** Priya Nair. Roastery books and our personal return
    `,
  },

  // ─── Garden Co-op ───────────────────────────────────────────────
  {
    title: 'Treasurer handoff notes for Joan',
    area_name: 'Garden Co-op',
    task_title: 'Hand the treasurer books to Joan',
    createdAt: daysAgo(47, 20, 0),
    body: md`
      For Joan. What the treasurer actually does.

      ## Monthly
      - Reconcile the co-op checking account against the ledger spreadsheet
      - Pay the water bill. Autopay is NOT on, the city portal is ancient
      - Deposit plot fees (checks trickle in through April)

      ## Yearly
      - Liability insurance renews in March, $612 last year
      - Plot fees: $45 standard, $20 reduced, and nobody gets turned away
      - Treasurer's report at the spring members meeting

      ## Where things are
      - Ledger: the shared drive, "Treasurer" folder
      - Checkbook: the lockbox in the shed, combo is in the board email
      - Bank: two signers over $500, me and Ruth. Swap me for Joan at the branch
    `,
  },

  // ─── Portuguese ─────────────────────────────────────────────────
  {
    title: 'Lisbon and Porto trip ideas',
    area_name: 'Portuguese',
    createdAt: daysAgo(43, 21, 30),
    body: md`
      Two weeks in April. Lisbon first (6 nights), train to Porto (5 nights), maybe a day trip, fly home from Porto.

      ## Lisbon
      - Stay in Graça or Alfama. The hills are brutal with a 7 year old, so near the 28 tram line
      - Oceanário. Ruby will want to move in
      - Pastéis de Belém, early, before the line
      - LX Factory on a Sunday
      - Miradouro da Senhora do Monte at sunset
      - Time Out Market is touristy, but an easy dinner with a kid

      ## Porto
      - Livraria Lello (book tickets ahead)
      - Walk the top deck of the Dom Luís I bridge
      - Port lodge tour in Gaia. Theo and I take turns
      - One francesinha, for the story
      - Coffee: ask Ana for her list. Luis swears by a roaster in Cedofeita

      ## Porto apartment shortlist
      - Cedofeita, 2 bed, €128 a night, washer. Front-runner
      - Ribeira, 2 bed, €152 a night, river view, 4th floor with no lift (no)
      - Bonfim, 2 bed, €109 a night, 15 minute walk to the center

      ## Before we go
      - Passports (mine expires in June)
      - Lisbon to Porto train tickets open about 60 days ahead
      - Enough Portuguese to order for Ruby without pointing
    `,
  },
  {
    title: 'Portuguese phrases that keep tripping me up',
    area_name: 'Portuguese',
    createdAt: daysAgo(26, 20, 30),
    body: md`
      The ones Ana keeps correcting.

      - **Obrigada**, not obrigado. It agrees with me, not with the person I'm thanking.
      - **Queria um café**, not "quero". Quero sounds like a demand.
      - **Pois** means about nine things. Mostly "yeah, right, exactly".
      - **Estou a fazer** (Portugal) vs **estou fazendo** (Brazil). Ana winces at the second one.
      - **Uma bica** is an espresso in Lisbon. In Porto, ask for **um cimbalino**.
      - **Com licença** to squeeze past someone, **desculpe** for sorry. I mix them up every single time.
      - Swallowed vowels: "telefone" comes out like "tlfon". Listening is the hard part.
    `,
  },
  {
    title: 'Practice Portuguese (European)',
    area_name: 'Portuguese',
    url: 'https://www.practiceportuguese.com/',
    createdAt: daysAgo(38, 19, 0),
    body: 'Ana recommended it. European pronunciation, short episodes. The shorts are good on easy runs.',
  },

  // ─── Brightline Analytics ───────────────────────────────────────
  {
    title: 'Brightline exit checklist',
    area_name: 'Brightline Analytics',
    status: 'archived',
    createdAt: daysAgo(57, 21, 10),
    body: md`
      - [x] Hand off dashboards and the data dictionary
      - [x] Return badge and laptop
      - [x] Final expense report (mostly)
      - [x] Download my own performance reviews
      - [x] Benefits paperwork (didn't need it, went on Theo's plan)
      - [x] Goodbye lunch with the team
    `,
  },

  // ─── No area ────────────────────────────────────────────────────
  {
    title: 'Weekly review: last week',
    createdAt: daysAgo(2, 20, 30),
    body: md`
      ## What happened
      - The wholesale order form finally handles case quantities. Luis did a small dance.
      - 16 miles at 9:03s, no walking. The calf is the thing to watch.
      - Fieldnote: proved where the sync bug lives. Sightings vanish when the phone locks mid-upload. Ugh, but relieved it's reproducible.
      - Booked Ruby's parent-teacher conference. She has been calling it "the meeting about me".

      ## What slipped
      - Skylight. Again. Fourth week running. Either text Hector or admit I live with a bucket now ({{task:Fix the leaky skylight}}).
      - Ruby's 529 bump. Five minutes. Still not done.
      - The treasurer handoff. Joan hasn't asked, which somehow makes it worse.

      ## Next week
      1. Green coffee contract. Hard deadline, real money ({{task:Order green coffee for winter}})
      2. The sync fix, so the App Store submission can happen
      3. The 18 miler without wrecking the calf

      ## How it felt
      Tired, mostly the good kind. Too many evenings at the laptop and Theo noticed. Protect Friday.
    `,
  },
  {
    title: "Book notes: What It's Like to Be a Bird",
    createdAt: daysAgo(29, 21, 45),
    body: md`
      David Allen Sibley. Reading a few pages a night with Ruby. She picks the bird.

      - Crows recognize individual human faces and hold a grudge. Ruby now waves at every crow.
      - A woodpecker's tongue wraps around the inside of its skull.
      - Hummingbirds drop into torpor at night to save energy, a nightly mini-hibernation.
      - Many owls have ears at different heights, so they can place a sound up and down, not just left and right.

      Fieldnote idea from this: a "did you know" line on the confirm screen. Not for 1.0.
    `,
  },
  {
    title: 'Gym locker combo',
    createdAt: hoursAgo(30),
    body: '18-32-7. Top left bank, by the pool doors.',
  },
];
