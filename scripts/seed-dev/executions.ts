/**
 * Executions for the dev seed: each one a piece of agent work in one of the
 * seed projects, with a transcript, the git work it left on its branch, and
 * the state it's in. Together they cover what the rail and workbench show:
 * finished and waiting for review (unread), waiting on an answer, a PR with a
 * preview and an accepted review, a failed setup script, pinned, a Codex
 * session with uncommitted changes, a plain-folder agent, and archived work
 * merged into main.
 *
 * `startAt` anchors the transcript. Branch commits land at offsets from it
 * so the history reads as the agent's own.
 */

import type { Step } from './chat';
import { tools } from './chat';
import type { AgentSlug } from './tasks';
import type { SeedFileName } from './files';
import { daysAgo, hoursAgo, minutesAgo } from './time';
import { syncQueueOriginal } from './projects';

const { bash, read, edit, write, grep, todos, shell } = tools;

export interface BranchCommit {
  /** Minutes after the transcript starts. */
  afterMin: number;
  message: string;
  files: Record<string, string | null>;
}

export interface ExecutionDef {
  key: string;
  agent: AgentSlug;
  label: string;
  harness: 'claude' | 'codex';
  model: string;
  taskTitle?: string;
  startAt: string;
  /** Git work on the execution's branch. */
  commits?: BranchCommit[];
  /** Left uncommitted in the worktree. */
  uncommitted?: Record<string, string | null>;
  /** Push the branch to origin. */
  push?: boolean;
  /** Merge into main and archive this many days ago. */
  archivedDaysAgo?: number;
  pinned?: boolean;
  prNumber?: number;
  previewUrl?: string;
  setupScriptError?: string;
  /** Whether Maya has looked since the agent's last reply. */
  seen: boolean;
  review?: 'accepted' | 'changes_requested';
  /** Files written into a plain-folder agent's own folder. */
  folderFiles?: Record<string, string>;
  /** Seed files attached to Maya's first message. */
  firstMessageAttachments?: SeedFileName[];
  steps: Step[];
}

const syncQueueFixed = `import Foundation

/// Holds sightings recorded offline until the upload client can send them.
/// A sighting leaves the queue only after its upload succeeds, and the queue
/// is written to disk after every change, so a crash or a kill mid-flush
/// loses nothing.
final class SyncQueue {
    private var pending: [Sighting] = []
    private let client: UploadClient
    private let store: SightingStore
    private var flushing = false

    init(client: UploadClient, store: SightingStore) {
        self.client = client
        self.store = store
        self.pending = store.loadPending()
    }

    func enqueue(_ sighting: Sighting) {
        pending.append(sighting)
        store.savePending(pending)
    }

    /// Called when connectivity returns or the app comes to the foreground.
    func flush() async {
        guard !flushing else { return }
        flushing = true
        defer { flushing = false }
        for sighting in pending {
            do {
                try await client.upload(sighting)
                pending.removeAll { $0.id == sighting.id }
                store.savePending(pending)
            } catch {
                // Leave it queued. The next flush retries it.
                break
            }
        }
    }
}
`;

const storeFixed = `import Foundation

final class SightingStore {
    private let url: URL
    private let pendingURL: URL

    init(directory: URL) {
        url = directory.appendingPathComponent("sightings.json")
        pendingURL = directory.appendingPathComponent("pending.json")
    }

    func loadAll() -> [Sighting] { load(url) }
    func save(_ sightings: [Sighting]) { write(sightings, to: url) }

    func loadPending() -> [Sighting] { load(pendingURL) }
    func savePending(_ sightings: [Sighting]) { write(sightings, to: pendingURL) }

    private func load(_ file: URL) -> [Sighting] {
        guard let data = try? Data(contentsOf: file) else { return [] }
        return (try? JSONDecoder().decode([Sighting].self, from: data)) ?? []
    }

    private func write(_ sightings: [Sighting], to file: URL) {
        let data = try? JSONEncoder().encode(sightings)
        try? data?.write(to: file, options: .atomic)
    }
}
`;

const swiftTestPass = `Building for debugging...
[14/14] Linking FieldnoteTests
Build complete! (6.82s)
Test Suite 'All tests' started at 2026-10-06 07:12:44.118.
Test Suite 'SyncQueueTests' started
Test Case '-[FieldnoteTests.SyncQueueTests testEnqueuePersists]' passed (0.002 seconds).
Test Case '-[FieldnoteTests.SyncQueueTests testFailedUploadStaysQueued]' passed (0.004 seconds).
Test Case '-[FieldnoteTests.SyncQueueTests testKilledMidFlushKeepsUnsent]' passed (0.006 seconds).
Test Case '-[FieldnoteTests.SyncQueueTests testPendingSurvivesRelaunch]' passed (0.003 seconds).
Test Case '-[FieldnoteTests.SightingStoreTests testRoundTrip]' passed (0.001 seconds).
Test Case '-[FieldnoteTests.SightingStoreTests testPendingFileIsSeparate]' passed (0.001 seconds).
Test Suite 'All tests' passed at 2026-10-06 07:12:44.140.
\t Executed 6 tests, with 0 failures (0 unexpected) in 0.017 (0.019) seconds`;

const transcriberWip = `import Speech

/// Turns a recorded voice note into text, on the device, so it works with
/// no signal. Bird names are passed as contextual strings to bias recognition.
final class Transcriber {
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))

    func transcribe(_ url: URL, hints: [String]) async throws -> String {
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.requiresOnDeviceRecognition = true
        request.contextualStrings = Array(hints.prefix(100))
        return try await withCheckedThrowingContinuation { continuation in
            recognizer?.recognitionTask(with: request) { result, error in
                if let error { continuation.resume(throwing: error); return }
                if let result, result.isFinal { continuation.resume(returning: result.bestTranscription.formattedString) }
            }
        }
    }
}
`;

export const executions: ExecutionDef[] = [
  // ─── Needs review: finished, unread ─────────────────────────
  {
    key: 'sync-fix',
    agent: 'fieldnote-ios',
    label: 'Fix offline sync dropping sightings',
    harness: 'claude',
    model: 'opus',
    taskTitle: 'Fix offline sync dropping sightings',
    startAt: hoursAgo(3.2),
    seen: false,
    firstMessageAttachments: ['sync-bug-screenshot.png'],
    commits: [
      { afterMin: 3, message: 'Persist the pending queue to disk', files: { 'Fieldnote/Storage/SightingStore.swift': storeFixed } },
      { afterMin: 7, message: 'Only drop a sighting after its upload succeeds', files: {
        'Fieldnote/Sync/SyncQueue.swift': syncQueueFixed,
        'FieldnoteTests/SyncQueueTests.swift': 'import XCTest\n@testable import Fieldnote\n\nfinal class SyncQueueTests: XCTestCase {\n    func testEnqueuePersists() {\n        let store = InMemoryStore()\n        let queue = SyncQueue(client: .init(), store: store)\n        queue.enqueue(.fixture)\n        XCTAssertEqual(store.pending.count, 1)\n    }\n\n    func testFailedUploadStaysQueued() async {\n        let store = InMemoryStore()\n        let queue = SyncQueue(client: .failing, store: store)\n        queue.enqueue(.fixture)\n        await queue.flush()\n        XCTAssertEqual(store.pending.count, 1)\n    }\n\n    func testKilledMidFlushKeepsUnsent() async {\n        let store = InMemoryStore()\n        let queue = SyncQueue(client: .slow(failAfter: 1), store: store)\n        [Sighting.fixture, .fixture2, .fixture3].forEach(queue.enqueue)\n        await queue.flush()\n        XCTAssertEqual(store.pending.map(\\.species), ["Belted Kingfisher", "Red-tailed Hawk"])\n    }\n}\n',
      } },
    ],
    steps: [
      { user: "Testers keep losing sightings. Recorded 3 on the riverside trail with no signal this morning, opened the app at home and only one synced. Screenshot attached. Can you find it and fix it? Don't change the store format for sightings.json." },
      { think: '' },
      todos([['Reproduce the loss from the flush path', 'in_progress'], ['Fix the queue so nothing is dropped', 'pending'], ['Add tests for kill mid-flush and failed upload', 'pending'], ['Run swift test', 'pending']]),
      read('Fieldnote/Sync/SyncQueue.swift', syncQueueOriginal),
      grep('savePending|loadPending', 'Fieldnote/Storage/SightingStore.swift:24:    func loadPending() -> [Sighting] { [] }\nFieldnote/Storage/SightingStore.swift:25:    func savePending(_ sightings: [Sighting]) {}\nFieldnote/Sync/SyncQueue.swift:13:        self.pending = store.loadPending()\nFieldnote/Sync/SyncQueue.swift:18:        store.savePending(pending)\nFieldnote/Sync/SyncQueue.swift:25:        store.savePending(pending)', 'Fieldnote'),
      { think: '' },
      { say: "Found it, and it's two bugs stacked:\n\n1. `flush()` empties the queue and saves the empty queue **before** any upload runs. If iOS suspends the app mid-flush (common when you open it and switch away), the rest of the batch only exists in memory and is gone.\n2. `loadPending` and `savePending` in `SightingStore` are stubs. The queue was never written to disk at all, so even a clean relaunch starts empty.\n\nYour screenshot matches: the Waxwing uploaded first, then the app was suspended with the other two in memory. Fixing both now. `sightings.json` stays exactly as it is. Pending items go in a separate `pending.json`." },
      edit('Fieldnote/Storage/SightingStore.swift', '    func loadPending() -> [Sighting] { [] }\n    func savePending(_ sightings: [Sighting]) {}', '    func loadPending() -> [Sighting] { load(pendingURL) }\n    func savePending(_ sightings: [Sighting]) { write(sightings, to: pendingURL) }'),
      bash('git add -A && git commit -q -m "Persist the pending queue to disk" && git log --oneline -1', 'a41c9e2 Persist the pending queue to disk', 'Commit the store fix'),
      edit('Fieldnote/Sync/SyncQueue.swift', '        let batch = pending\n        pending.removeAll()\n        store.savePending(pending)\n        for sighting in batch {', '        guard !flushing else { return }\n        flushing = true\n        defer { flushing = false }\n        for sighting in pending {'),
      edit('FieldnoteTests/SyncQueueTests.swift', '        XCTAssertEqual(store.pending.count, 1)\n    }\n}', '        XCTAssertEqual(store.pending.count, 1)\n    }\n\n    func testKilledMidFlushKeepsUnsent() async {\n        // ...\n    }\n}'),
      todos([['Reproduce the loss from the flush path', 'completed'], ['Fix the queue so nothing is dropped', 'completed'], ['Add tests for kill mid-flush and failed upload', 'completed'], ['Run swift test', 'in_progress']]),
      bash('swift test 2>&1 | tail -12', swiftTestPass, 'Run the test suite', 24),
      bash('git add -A && git commit -q -m "Only drop a sighting after its upload succeeds" && git log --oneline main..HEAD', 'c07d3b8 Only drop a sighting after its upload succeeds\na41c9e2 Persist the pending queue to disk', 'Commit the queue fix'),
      { say: "Fixed, on two commits:\n\n- **Persist the pending queue to disk.** `SightingStore` now really reads and writes `pending.json`. `sightings.json` is untouched.\n- **Only drop a sighting after its upload succeeds.** Each sighting leaves the queue after a 201, and the queue is saved after every upload. A failed upload stays queued for the next flush, and a second flush can't start while one is running.\n\nTests: 6 passed, including two new ones that simulate the app being killed mid-flush and a failing upload.\n\nOne thing worth knowing: anything testers lost before this build is not recoverable, since it was never written to disk. Want me to push the branch and open a PR, or bump the build number for TestFlight first?" },
    ],
  },

  // ─── Waiting on an answer ───────────────────────────────────
  {
    key: 'voice-notes',
    agent: 'fieldnote-ios',
    label: 'Voice notes: transcribe on device',
    harness: 'claude',
    model: 'opus',
    taskTitle: 'Voice notes: transcribe on device',
    startAt: daysAgo(1, 20, 40),
    seen: true,
    commits: [
      { afterMin: 4, message: 'WIP: on-device transcriber with species hints', files: { 'Fieldnote/Voice/Transcriber.swift': transcriberWip } },
    ],
    uncommitted: {
      'Fieldnote/Voice/SpeciesHints.swift': 'import Foundation\n\n/// The most likely species for a region and month, used as recognition hints.\n/// Placeholder list until we decide on the data source.\nenum SpeciesHints {\n    static let common = [\n        "Cedar Waxwing", "Belted Kingfisher", "Red-tailed Hawk", "Black-capped Chickadee",\n        "Northern Flicker", "Dark-eyed Junco", "Song Sparrow", "Great Blue Heron",\n    ]\n}\n',
    },
    steps: [
      { user: 'Next up for 1.0: when someone records a voice note, turn it into text for the note field. Has to work offline, that is the whole pitch.' },
      { think: '' },
      read('Fieldnote/Voice/VoiceRecorder.swift', 'import AVFoundation\n\nfinal class VoiceRecorder {\n    private var recorder: AVAudioRecorder?\n    ...'),
      write('Fieldnote/Voice/Transcriber.swift', transcriberWip),
      bash('swift build 2>&1 | tail -3', 'Building for debugging...\n[9/9] Compiling Fieldnote Transcriber.swift\nBuild complete! (4.11s)', 'Build with the transcriber', 9),
      bash('swift run fieldnote-probe transcribe Fixtures/voice/waxwing-riverside.m4a', 'on-device: "see the wax wing two of them in the willows by the bridge"\nwith hints: "Cedar Waxwing two of them in the willows by the bridge"', 'Try the fixture recording', 14),
      bash('git add Fieldnote/Voice/Transcriber.swift && git commit -q -m "WIP: on-device transcriber with species hints"', '', 'Commit the work in progress'),
      { say: "I have on-device transcription working (WIP commit on the branch). Your decision note says on-device only, so no server. Before I go further I need one call, because it decides the data work.\n\nWithout help, recognition mangles bird names: it heard \"Cedar Waxwing\" as \"see the wax wing\". Passing species names as hints fixes that, but iOS only takes about 100 hints per request, so they have to be the likeliest birds for where and when the note was recorded. Where should that come from?\n\n**Option A: a bundled regional list.** Ship the ~1,100 species on the AOS North American checklist with rough range and season. Fully offline, about a day of data work, a few hundred KB in the app.\n\n**Option B: eBird frequency data.** Much better odds per location, but it needs an API key, its terms limit redistribution, and refreshing it needs the network.\n\nI'd go with A for 1.0 and revisit B later. Which do you want?" },
    ],
  },

  // ─── PR open with a preview, review accepted ────────────────
  {
    key: 'landing',
    agent: 'fieldnote-site',
    label: 'Landing page hero and waitlist form',
    harness: 'claude',
    model: 'opus',
    taskTitle: 'Launch landing page with waitlist',
    startAt: daysAgo(2, 19, 15),
    seen: true,
    push: true,
    prNumber: 12,
    previewUrl: 'https://deploy-preview-12--fieldnote.netlify.app',
    review: 'accepted',
    commits: [
      { afterMin: 3, message: 'Hero, three feature cards and the waitlist form', files: {
        'src/components/Hero.astro': "<section class=\"hero\">\n  <h1>Hear a bird? Just talk.</h1>\n  <p>Fieldnote turns what you say into a sighting log, even with no signal on the trail.</p>\n  <a class=\"cta\" href=\"#waitlist\">Join the waitlist</a>\n</section>\n",
        'src/components/WaitlistForm.astro': "<form id=\"waitlist\" name=\"waitlist\" method=\"POST\" data-netlify=\"true\">\n  <label>Email <input type=\"email\" name=\"email\" required /></label>\n  <button type=\"submit\">Sign up</button>\n  <p class=\"fine\">One email when the beta opens. No spam.</p>\n</form>\n",
        'src/pages/index.astro': "---\nimport Base from '../layouts/Base.astro';\nimport Hero from '../components/Hero.astro';\nimport WaitlistForm from '../components/WaitlistForm.astro';\n---\n<Base title=\"Fieldnote: log birds by voice\">\n  <Hero />\n  <WaitlistForm />\n</Base>\n",
      } },
      { afterMin: 31, message: 'Button copy: Join the waitlist', files: {
        'src/components/WaitlistForm.astro': "<form id=\"waitlist\" name=\"waitlist\" method=\"POST\" data-netlify=\"true\">\n  <label>Email <input type=\"email\" name=\"email\" required /></label>\n  <button type=\"submit\">Join the waitlist</button>\n  <p class=\"fine\">One email when the beta opens. No spam.</p>\n</form>\n",
      } },
    ],
    steps: [
      { user: 'Build the landing page: big hero, three short feature cards (voice, offline, life list), and a waitlist form that goes to Netlify Forms. Keep it light, the page should load instantly on bad trail signal too.' },
      { think: '' },
      todos([['Hero and feature cards', 'in_progress'], ['Waitlist form with Netlify Forms', 'pending'], ['Build and check page weight', 'pending'], ['Push and open a PR', 'pending']]),
      write('src/components/Hero.astro', '<section class="hero">\n  <h1>Hear a bird? Just talk.</h1>\n  ...'),
      write('src/components/WaitlistForm.astro', '<form id="waitlist" name="waitlist" method="POST" data-netlify="true">\n  ...'),
      bash('pnpm build 2>&1 | tail -6', '17:42:10 [build] output: "static"\n17:42:10 [build] Collecting build info...\n17:42:11 ▶ src/pages/index.astro\n17:42:11   └─ /index.html (+14ms)\n17:42:11 [build] 1 page(s) built in 1.32s\n17:42:11 [build] Complete!', 'Production build', 8),
      bash('du -k dist/index.html dist/_astro/*.css | sort -n', '6\tdist/index.html\n9\tdist/_astro/index.Bq3nX2a1.css', 'Check page weight'),
      bash('git push -q -u origin HEAD && gh pr create --fill --title "Landing page: hero and waitlist"', 'https://github.com/tidewater/fieldnote-site/pull/12', 'Push and open the PR', 6),
      { say: "Done and up for review: **PR #12**. Netlify's deploy preview is building at deploy-preview-12--fieldnote.netlify.app.\n\n- Hero with the \"Hear a bird? Just talk.\" line from the onboarding screens\n- Three feature cards: voice, offline, life list\n- Waitlist form posting to Netlify Forms, with a one-line no-spam promise\n\nThe whole page is 15 KB (6 KB HTML, 9 KB CSS), no JavaScript." },
      { user: 'Love it. Can the button say "Join the waitlist" instead of "Sign up"? Matches the hero link.', gapMin: 26 },
      edit('src/components/WaitlistForm.astro', '<button type="submit">Sign up</button>', '<button type="submit">Join the waitlist</button>'),
      bash('git commit -qam "Button copy: Join the waitlist" && git push -q', '', 'Commit and push'),
      { say: 'Changed and pushed. The preview will refresh in about a minute.' },
    ],
  },

  // ─── Setup script failed ────────────────────────────────────
  {
    key: 'skip-month',
    agent: 'tidewater-shop',
    label: 'Subscription: let customers skip a month',
    harness: 'claude',
    model: 'sonnet',
    taskTitle: 'Subscription: let customers skip a month',
    startAt: hoursAgo(26),
    seen: false,
    setupScriptError:
      ' ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/hono: request to https://registry.npmjs.org/hono failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org\n\nThis error happened while installing the dependencies of tidewater-shop@0.0.0\nExit code 1',
    steps: [
      { user: 'Subscribers keep emailing Luis to skip a month (vacations mostly). Add a skip-next-shipment option: it should push nextShipDate one month and send no box that month. Max 2 skips in a row.' },
      { think: '' },
      read('src/subscriptions.ts', "export type Plan = 'one-bag' | 'two-bag' | 'office';\n..."),
      bash('pnpm test', 'sh: vitest: command not found\n ELIFECYCLE  Test failed. See above for more details.', 'Run the existing tests', 2),
      { say: "I can't run anything yet: the setup script failed when this execution started (`pnpm install` couldn't reach the npm registry, so there's no `node_modules`). It looks like the network was down for a moment.\n\nUse **Retry setup** on the banner above and I'll pick up from here. The plan: add `skipNext(sub)` that advances `nextShipDate` and counts consecutive skips, refuse a third, and a test for each case." },
    ],
  },

  // ─── Pinned, finished, read ─────────────────────────────────
  {
    key: 'roast-curves',
    agent: 'roast-lab',
    label: 'Chart roast curves from Artisan logs',
    harness: 'claude',
    model: 'opus',
    taskTitle: 'Chart roast curves from Artisan logs',
    startAt: daysAgo(3, 14, 5),
    seen: true,
    pinned: true,
    push: true,
    commits: [
      { afterMin: 2, message: 'Plot bean and environment temperature from an alog', files: {
        'roastlab/plot.py': 'from pathlib import Path\n\nimport matplotlib.pyplot as plt\n\nfrom .parse_artisan import load\n\n\ndef plot(log_path: Path, out: Path) -> Path:\n    log = load(log_path)\n    plt.style.use("dark_background")\n    fig, ax = plt.subplots(figsize=(12, 7))\n    ax.plot(log["timex"], log["temp2"], label="Bean temp", color="#5aa6d6", linewidth=2.5)\n    ax.plot(log["timex"], log["temp1"], label="Environment temp", color="#c2563a")\n    ax.set_xlabel("Time")\n    ax.set_ylabel("°F")\n    ax.legend()\n    fig.savefig(out, dpi=150, bbox_inches="tight")\n    return out\n',
      } },
      { afterMin: 18, message: 'Rate of rise and dry end, first crack, drop markers', files: {
        'roastlab/plot.py': 'from pathlib import Path\n\nimport matplotlib.pyplot as plt\nimport numpy as np\n\nfrom .parse_artisan import load\n\nEVENTS = {"DRY_time": "Dry end", "FCs_time": "First crack", "DROP_time": "Drop"}\n\n\ndef rate_of_rise(t: np.ndarray, bt: np.ndarray, window: int = 30) -> np.ndarray:\n    """Degrees per minute over a trailing window, in seconds."""\n    ror = np.gradient(bt, t) * 60\n    kernel = np.ones(window // 4) / (window // 4)\n    return np.convolve(ror, kernel, mode="same")\n\n\ndef plot(log_path: Path, out: Path) -> Path:\n    log = load(log_path)\n    t, bt, et = (np.array(log[k], dtype=float) for k in ("timex", "temp2", "temp1"))\n    plt.style.use("dark_background")\n    fig, ax = plt.subplots(figsize=(12, 7))\n    ax.plot(t, bt, label="Bean temp", color="#5aa6d6", linewidth=2.5)\n    ax.plot(t, et, label="Environment temp", color="#c2563a")\n    ror_ax = ax.twinx()\n    ror_ax.plot(t, rate_of_rise(t, bt), label="Rate of rise", color="#7fbf6a")\n    for key, name in EVENTS.items():\n        at = log["computed"][key]\n        ax.axvline(at, color="#d6a65a", linestyle="--")\n        ax.annotate(f"{name} {at // 60}:{at % 60:02d}", (at, ax.get_ylim()[1]), color="#d6a65a")\n    ax.legend(loc="lower right")\n    fig.savefig(out, dpi=150, bbox_inches="tight")\n    return out\n',
      } },
    ],
    steps: [
      { user: 'I want to stop screenshotting Artisan. Write a script that takes an .alog and makes a clean chart of the roast. Start with the Guji batch in data/.' },
      { think: '' },
      read('data/2026-09-28-guji-natural.alog', "{'roastertype': 'Loring S15', 'title': 'Guji natural 214', 'weight': [15.0, 12.8, 'Kg'], ..."),
      write('roastlab/plot.py', 'from pathlib import Path\n\nimport matplotlib.pyplot as plt\n...'),
      bash('uv run python -c "from roastlab.plot import plot; from pathlib import Path; print(plot(Path(\'data/2026-09-28-guji-natural.alog\'), Path(\'out/guji-natural.png\')))"', 'out/guji-natural.png', 'Render the first chart', 6),
      { say: 'First version is at `out/guji-natural.png`: bean temperature and environment temperature over time, dark background, Fahrenheit. The alog is a Python literal rather than JSON, so the parser uses `ast.literal_eval`.' },
      { user: 'Good start. Add rate of rise on a second axis and mark dry end, first crack and drop, like Artisan does.', gapMin: 14 },
      edit('roastlab/plot.py', 'ax.legend()', 'ror_ax = ax.twinx()\n    ror_ax.plot(t, rate_of_rise(t, bt), label="Rate of rise", color="#7fbf6a")\n    ...\n    ax.legend(loc="lower right")'),
      bash('uv run python -m roastlab.plot data/2026-09-28-guji-natural.alog out/guji-natural.png && uv run python -m roastlab.parse_artisan data/2026-09-28-guji-natural.alog', 'out/guji-natural.png\nGuji natural 214: drop 10:52 at 412F, development 19.4%', 'Render with RoR and markers', 7),
      bash('git push -q -u origin HEAD', '', 'Push the branch'),
      { say: "Updated. The chart now has rate of rise on a right-hand axis (smoothed over 30 seconds) and dashed markers for dry end 6:28, first crack 8:47 and drop 10:52. Development time came out at 19.4%, which matches what Artisan reported.\n\nI saved a copy into your roast profile note too. Pushed to the branch." },
    ],
  },

  // ─── Codex, uncommitted changes ─────────────────────────────
  {
    key: 'parser-package',
    agent: 'roast-lab',
    label: 'Refactor roast log parser into a package',
    harness: 'codex',
    model: 'gpt-6.1-sol',
    taskTitle: 'Refactor roast log parser into a package',
    startAt: daysAgo(1, 11, 20),
    seen: true,
    uncommitted: {
      'roastlab/artisan/__init__.py': 'from .model import RoastLog\nfrom .reader import read_alog\n\n__all__ = ["RoastLog", "read_alog"]\n',
      'roastlab/artisan/model.py': 'from dataclasses import dataclass\n\n\n@dataclass(frozen=True)\nclass RoastLog:\n    title: str\n    roaster: str\n    charge_kg: float\n    yield_kg: float\n    seconds: list[float]\n    bean_temp: list[float]\n    env_temp: list[float]\n    dry_end: int\n    first_crack: int\n    drop: int\n    drop_temp: float\n\n    @property\n    def development_pct(self) -> float:\n        return (self.drop - self.first_crack) / self.drop * 100\n\n    @property\n    def weight_loss_pct(self) -> float:\n        return (1 - self.yield_kg / self.charge_kg) * 100\n',
      'roastlab/artisan/reader.py': 'import ast\nfrom pathlib import Path\n\nfrom .model import RoastLog\n\n\ndef read_alog(path: Path) -> RoastLog:\n    raw = ast.literal_eval(Path(path).read_text())\n    c = raw["computed"]\n    charge, yield_, _unit = raw["weight"]\n    return RoastLog(\n        title=raw["title"], roaster=raw["roastertype"], charge_kg=charge, yield_kg=yield_,\n        seconds=raw["timex"], bean_temp=raw["temp2"], env_temp=raw["temp1"],\n        dry_end=c["DRY_time"], first_crack=c["FCs_time"], drop=c["DROP_time"], drop_temp=c["DROP_BT"],\n    )\n',
      'roastlab/parse_artisan.py': null,
      'tests/test_reader.py': 'from pathlib import Path\n\nfrom roastlab.artisan import read_alog\n\n\ndef test_guji_summary():\n    log = read_alog(Path("data/2026-09-28-guji-natural.alog"))\n    assert log.drop == 652\n    assert round(log.development_pct, 1) == 19.2\n    assert round(log.weight_loss_pct, 1) == 14.7\n',
    },
    steps: [
      { user: 'Turn parse_artisan.py into a small package with a typed RoastLog object. I want to compare batches next, so give it weight loss and development percent.' },
      { think: 'Read the current parser and its callers, then split reading from the model.' },
      shell('rg -n "parse_artisan|literal_eval" -S .', 'roastlab/parse_artisan.py:1:import ast\nroastlab/parse_artisan.py:8:    return ast.literal_eval(path.read_text())\nroastlab/plot.py:6:from .parse_artisan import load'),
      shell('cat roastlab/parse_artisan.py', 'import ast\nimport sys\nfrom pathlib import Path\n\n\ndef load(path: Path) -> dict:\n    """Artisan writes a Python literal, not JSON."""\n    return ast.literal_eval(path.read_text())\n...'),
      { think: 'Model as a frozen dataclass with derived percentages; keep the reader separate so other formats can come later.' },
      shell('mkdir -p roastlab/artisan tests && git mv roastlab/parse_artisan.py roastlab/artisan/reader.py', ''),
      shell('uv run pytest -q', '.                                                                        [100%]\n1 passed in 0.21s', 0, 5),
      { say: 'Split the parser into `roastlab.artisan`:\n\n- `RoastLog`, a frozen dataclass with `development_pct` and `weight_loss_pct`\n- `read_alog(path)`, which returns a `RoastLog`\n- a test against the Guji batch: development 19.2%, weight loss 14.7%\n\n`plot.py` still imports the old `load`, so I left the changes uncommitted for you to look at before I update it. Development reads 19.2% here instead of the 19.4% the chart shows because this uses the first-crack start time, which is what Artisan does too. Want me to switch the chart to the new model as well?' },
    ],
  },

  // ─── Plain-folder agent ─────────────────────────────────────
  {
    key: 'taxes',
    agent: 'household',
    label: 'Organize 2026 tax documents',
    harness: 'claude',
    model: 'opus',
    taskTitle: 'Organize 2026 tax documents',
    startAt: daysAgo(1, 9, 30),
    seen: false,
    folderFiles: {
      'taxes/2026/checklist.md': '# 2026 taxes: what we have and what is missing\n\n## Have\n\n- [x] W-2, Theo (Linden USD): wages 71,480, withheld 6,912\n- [x] 1099-K, Square (Tidewater): gross 184,233.17\n- [x] 1098 mortgage interest, Linden Credit Union (acct ...2291): 9,402.55\n- [x] After-school care receipts, Jan to Sep: 3,240\n\n## Missing\n\n- [ ] After-school care, Oct to Dec (ask Little Acorns in January)\n- [ ] Tidewater K-1 from Priya (after the LLC return)\n- [ ] Q4 estimated tax payment confirmation (due Jan 15)\n- [ ] 529 contribution statement for Ruby\n- [ ] Charitable receipts (garden co-op donation in May?)\n',
      'taxes/2026/summary.md': '# 2026 tax summary (draft)\n\nPrepared from the documents in `inbox/`. Originals untouched.\n\n| Item | Amount | Source |\n| --- | ---: | --- |\n| Theo wages | 71,480.00 | W-2 |\n| Federal withheld | 6,912.00 | W-2 |\n| Tidewater gross (1099-K) | 184,233.17 | Square |\n| Mortgage interest | 9,402.55 | 1098 |\n| Child care, Jan to Sep | 3,240.00 | Little Acorns |\n\nThe 1099-K is gross card volume, not profit. Priya needs it to reconcile against the books.\n',
    },
    steps: [
      { user: 'Tax stuff is piling up in taxes/2026/inbox. Make me a checklist of what we have and what is still missing, and a one-page summary I can send Priya. Do not move anything.' },
      { think: '' },
      bash('ls -1 taxes/2026/inbox', '1099-K Square (Tidewater).txt\nDaycare receipts Q1-Q3.txt\nMortgage interest 1098.txt\nW-2 Theo Brandt (Linden USD).txt', 'List the tax inbox'),
      read('taxes/2026/inbox/Mortgage interest 1098.txt', 'Form 1098\nLender: Linden Credit Union\nMortgage interest received: 9,402.55\nAccount ending 2291'),
      read('taxes/2026/inbox/1099-K Square (Tidewater).txt', 'Form 1099-K\nPayee: Tidewater Coffee Co. LLC\nGross payments: 184,233.17'),
      write('taxes/2026/checklist.md', '# 2026 taxes: what we have and what is missing\n...'),
      write('taxes/2026/summary.md', '# 2026 tax summary (draft)\n...'),
      { say: "Made two new files next to the inbox, nothing moved:\n\n- **taxes/2026/checklist.md**: 4 documents in hand, 5 still missing. The big ones are the Tidewater K-1 (Priya produces it after the LLC return) and Q4 after-school receipts.\n- **taxes/2026/summary.md**: a one-page table for Priya.\n\nHeads up: the 1099-K shows $184,233 in gross card volume. That's not profit, so it's worth a line to Priya so it gets reconciled against the books rather than taken at face value." },
    ],
  },

  // ─── Archived, merged ───────────────────────────────────────
  {
    key: 'order-validation',
    agent: 'tidewater-shop',
    label: 'Wholesale order form: validate case quantities',
    harness: 'claude',
    model: 'opus',
    taskTitle: 'Wholesale order form: validate case quantities',
    startAt: daysAgo(5, 10, 0),
    seen: true,
    archivedDaysAgo: 4,
    commits: [
      { afterMin: 2, message: 'Validate wholesale case quantities and SKUs', files: {
        'src/order-form.ts': "import { PRICE_PER_5LB_CENTS, CASE_BAGS } from './pricing';\n\nexport interface OrderLine { sku: string; cases: number }\n\nexport const MIN_CASES = 2;\nexport const MAX_CASES = 40;\n\nexport class OrderError extends Error {}\n\nexport function validateOrder(lines: OrderLine[]): void {\n  const total = lines.reduce((n, l) => n + l.cases, 0);\n  if (total < MIN_CASES) throw new OrderError(`Wholesale orders start at ${MIN_CASES} cases.`);\n  if (total > MAX_CASES) throw new OrderError(`Orders over ${MAX_CASES} cases need a call with Luis.`);\n  for (const l of lines) {\n    if (!(l.sku in PRICE_PER_5LB_CENTS)) throw new OrderError(`Unknown coffee: ${l.sku}`);\n    if (!Number.isInteger(l.cases) || l.cases < 1) throw new OrderError(`Cases must be a whole number for ${l.sku}.`);\n  }\n}\n\nexport function orderTotalCents(lines: OrderLine[]): number {\n  validateOrder(lines);\n  return lines.reduce((sum, l) => sum + PRICE_PER_5LB_CENTS[l.sku]! * CASE_BAGS * l.cases, 0);\n}\n",
        'test/order-form.test.ts': "import { describe, expect, it } from 'vitest';\nimport { orderTotalCents, OrderError } from '../src/order-form';\n\ndescribe('orderTotalCents', () => {\n  it('prices whole cases', () => expect(orderTotalCents([{ sku: 'house-blend', cases: 2 }])).toBe(49600));\n  it('refuses one case', () => expect(() => orderTotalCents([{ sku: 'house-blend', cases: 1 }])).toThrow(OrderError));\n  it('refuses unknown coffee', () => expect(() => orderTotalCents([{ sku: 'kona', cases: 3 }])).toThrow('Unknown coffee'));\n});\n",
      } },
    ],
    steps: [
      { user: "Grain & Gather ordered 0.5 cases last week and it went through. Wholesale minimum is 2 cases, whole cases only, and anything over 40 should go to Luis. Fix the order form." },
      { think: '' },
      read('src/order-form.ts', "import { PRICE_PER_5LB_CENTS, CASE_BAGS } from './pricing';\n..."),
      edit('src/order-form.ts', 'export function orderTotalCents(lines: OrderLine[]): number {', 'export function validateOrder(lines: OrderLine[]): void {\n  ...\n}\n\nexport function orderTotalCents(lines: OrderLine[]): number {\n  validateOrder(lines);'),
      bash('pnpm test 2>&1 | tail -5', ' ✓ test/order-form.test.ts (3 tests) 4ms\n ✓ test/subscriptions.test.ts (1 test) 2ms\n\n Test Files  2 passed (2)\n      Tests  4 passed (4)', 'Run tests', 6),
      { say: 'Fixed. Orders now need at least 2 whole cases in total, anything over 40 cases is refused with a message to call Luis, and an unknown coffee is refused instead of pricing at $0. Three new tests, all passing. Ready to merge.' },
      { user: 'Merged, thanks.', gapMin: 40 },
      { say: 'Great. I archived this execution. The branch stays in case you need it.' },
    ],
  },
  {
    key: 'astro-setup',
    agent: 'fieldnote-site',
    label: 'Set up Astro and deploy to Netlify',
    harness: 'claude',
    model: 'sonnet',
    startAt: daysAgo(20, 18, 30),
    seen: true,
    archivedDaysAgo: 19,
    commits: [
      { afterMin: 1, message: 'robots.txt and a 404 page', files: {
        'public/robots.txt': 'User-agent: *\nAllow: /\n',
        'src/pages/404.astro': "---\nimport Base from '../layouts/Base.astro';\n---\n<Base title=\"Not found\"><h1>Nothing here but birdsong.</h1></Base>\n",
      } },
    ],
    steps: [
      { user: 'Get the site deploying to Netlify from main, and add the usual robots.txt and a 404.' },
      bash('cat netlify.toml', '[build]\n  command = "pnpm build"\n  publish = "dist"', 'Check the Netlify config'),
      write('src/pages/404.astro', "---\nimport Base from '../layouts/Base.astro';\n---\n<Base title=\"Not found\">..."),
      { say: 'Netlify builds from main with `pnpm build` and publishes `dist`. Added `robots.txt` and a 404 page ("Nothing here but birdsong."). Merged.' },
    ],
  },
];

export { minutesAgo };
