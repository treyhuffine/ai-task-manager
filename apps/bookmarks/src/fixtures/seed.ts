/** The fictional library a preview opens with. No page is requested. */
import { transaction } from "@ri/app-kit/data";
import type { Bookmarks } from "../services/core.js";

const DAY = 86_400_000;
const LINKS: { url: string; title: string; tags: string[]; days: number; note?: string; text?: string; waiting?: boolean }[] = [
  { url: "https://harborlog.example/tide-tables", title: "Tide tables for small harbors", tags: ["sailing"], days: 3, note: "Check before the October trip.", text: "Tide tables list the height of the water at each hour. In a small harbor the entrance may only be safe two hours either side of high water, so plan your arrival from the table rather than the clock." },
  { url: "https://dbnotes.example/sqlite-indexes", title: "A field guide to SQLite indexes", tags: ["databases", "reference"], days: 9, text: "A covering index holds every column a query needs, so SQLite never reads the table. A partial index only helps when the query repeats its WHERE clause with literal values." },
  { url: "https://breadnotes.example/sourdough-timing", title: "Sourdough timing by room temperature", tags: ["cooking"], days: 21, text: "At 68 degrees bulk fermentation takes about eight hours. Each five degrees warmer takes roughly an hour and a half off, so watch the dough rather than the timer." },
  { url: "https://fieldnotes.example/rain-jackets", title: "How rain jackets actually fail", tags: ["gear"], days: 34, text: "Most rain jackets fail at the seams and the cuffs long before the fabric stops shedding water. Wash them often, because oil on the surface is what wets the outer layer." },
  { url: "https://typeset.example/line-length", title: "Line length and reading comfort", tags: ["design", "reference"], days: 48, note: "Good for the docs redesign.", text: "Comfortable line length sits between 45 and 75 characters. Longer lines make the eye lose its place on the return sweep, and shorter ones break reading rhythm." },
  { url: "https://atlas.example/lisbon-trams", title: "Lisbon's tram lines, drawn by hand", tags: ["travel", "maps"], days: 66, waiting: true },
  { url: "https://garden.example/winter-soil", title: "Putting a vegetable bed to rest", tags: ["garden"], days: 80, text: "Cover the soil before the first frost. A thick layer of leaves or a winter rye keeps worms working and stops rain from packing the surface." },
  { url: "https://radio.example/antenna-basics", title: "Antenna basics for shortwave listeners", tags: ["radio"], days: 120, text: "A long wire is the cheapest good antenna. Height matters more than length until about twenty meters, and keeping the wire away from house wiring cuts most of the noise." },
];

export function seedFixtures(t: Bookmarks) {
  if (t.fixtureSeeded()) return;
  transaction(t.db, () => {
    const now = t.now().getTime();
    for (const link of LINKS)
      t.saveOne({ url: link.url, title: link.title, tags: link.tags, note: link.note, pageText: link.text, savedAt: new Date(now - link.days * DAY).toISOString() }, "fixture", { fictional: true });
    t.markFixtureSeeded();
  });
}
