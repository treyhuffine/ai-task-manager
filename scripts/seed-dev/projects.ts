/**
 * The dev seed's agents and the projects they work in.
 *
 * Each agent gets a real folder under `<dev work dir>/seed-projects/`: a
 * small but genuine codebase with a few weeks of backdated commits, pushed
 * to a local bare remote so branches, ahead/behind counts and pushes behave
 * like a hosted repository. One agent (Household) is a plain folder of
 * documents, to show an agent without git. Reseeding wipes the dev home and
 * these folders with it.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentSlug } from './tasks';
import { daysAgo } from './time';

export const AUTHOR = { name: 'Maya Okafor', email: 'maya@tidewatercoffee.co' };

export function git(cwd: string, args: string[], at?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: AUTHOR.name,
      GIT_AUTHOR_EMAIL: AUTHOR.email,
      GIT_COMMITTER_NAME: AUTHOR.name,
      GIT_COMMITTER_EMAIL: AUTHOR.email,
      ...(at ? { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : {}),
      // Never read the machine's own git config hooks or signing setup.
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    },
  }).trim();
}

/** Write files (null deletes) under `dir`. */
export function writeFiles(dir: string, files: Record<string, string | null>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    if (content === null) {
      fs.rmSync(file, { force: true });
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

/** Stage everything and commit at `at`. */
export function commitAll(dir: string, message: string, at: string): string {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message], at);
  return git(dir, ['rev-parse', 'HEAD']);
}

export interface ProjectCommit {
  at: string;
  message: string;
  files: Record<string, string | null>;
}

export interface AgentDef {
  slug: AgentSlug;
  name: string;
  emoji: string;
  areaName: string;
  purpose: string;
  instructions: string;
  isGit: boolean;
  setupCommand?: string;
  startCommand?: string;
  /** First commit (or the folder's contents for a non-git agent). */
  files: Record<string, string>;
  /** Later commits on main, oldest first. */
  history: ProjectCommit[];
}

// ─── Fieldnote iOS ──────────────────────────────────────────────

const syncQueueOriginal = `import Foundation

/// Holds sightings recorded offline until the upload client can send them.
final class SyncQueue {
    private var pending: [Sighting] = []
    private let client: UploadClient
    private let store: SightingStore

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
        let batch = pending
        pending.removeAll()
        store.savePending(pending)
        for sighting in batch {
            do {
                try await client.upload(sighting)
            } catch {
                print("upload failed: \\(error)")
            }
        }
    }
}
`;

const fieldnoteIos: AgentDef = {
  slug: 'fieldnote-ios',
  name: 'Fieldnote iOS',
  emoji: '🐦',
  areaName: 'Fieldnote',
  purpose: 'The Fieldnote iPhone app: voice-first sighting log for birders. SwiftUI, offline first.',
  instructions:
    'Swift 6, SwiftUI, no third-party UI libraries. Run `swift test` before calling anything done. ' +
    'Never change the on-disk store format without a migration. Keep copy friendly and short, ' +
    'the way a birder would say it.',
  isGit: true,
  setupCommand: 'swift package resolve',
  files: {
    'README.md': '# Fieldnote\n\nLog bird sightings by voice, even with no signal.\n\n- `Fieldnote/` app sources\n- `FieldnoteTests/` unit tests\n\nRun tests with `swift test`.\n',
    'AGENTS.md': '# Working on Fieldnote\n\n- Swift 6, SwiftUI. Offline first: every write goes to the local store before the network.\n- `swift test` must pass.\n- Ask before adding a dependency.\n',
    'Package.swift': '// swift-tools-version: 6.0\nimport PackageDescription\n\nlet package = Package(\n    name: "Fieldnote",\n    platforms: [.iOS(.v17), .macOS(.v14)],\n    targets: [\n        .target(name: "Fieldnote", path: "Fieldnote"),\n        .testTarget(name: "FieldnoteTests", dependencies: ["Fieldnote"], path: "FieldnoteTests"),\n    ]\n)\n',
    '.gitignore': '.build/\nDerivedData/\n*.xcuserstate\n',
    'Fieldnote/Models/Sighting.swift': 'import Foundation\n\nstruct Sighting: Codable, Identifiable, Equatable {\n    let id: UUID\n    var species: String\n    var count: Int\n    var note: String\n    var latitude: Double\n    var longitude: Double\n    var recordedAt: Date\n}\n',
    'Fieldnote/App/FieldnoteApp.swift': 'import SwiftUI\n\n@main\nstruct FieldnoteApp: App {\n    var body: some Scene {\n        WindowGroup {\n            SightingListView()\n        }\n    }\n}\n',
  },
  history: [
    { at: daysAgo(41, 21, 10), message: 'Sighting list with local store', files: {
      'Fieldnote/Storage/SightingStore.swift': 'import Foundation\n\nfinal class SightingStore {\n    private let url: URL\n\n    init(directory: URL) {\n        url = directory.appendingPathComponent("sightings.json")\n    }\n\n    func loadAll() -> [Sighting] {\n        guard let data = try? Data(contentsOf: url) else { return [] }\n        return (try? JSONDecoder().decode([Sighting].self, from: data)) ?? []\n    }\n\n    func save(_ sightings: [Sighting]) {\n        let data = try? JSONEncoder().encode(sightings)\n        try? data?.write(to: url, options: .atomic)\n    }\n\n    func loadPending() -> [Sighting] { [] }\n    func savePending(_ sightings: [Sighting]) {}\n}\n',
      'Fieldnote/Views/SightingListView.swift': 'import SwiftUI\n\nstruct SightingListView: View {\n    @State private var sightings: [Sighting] = []\n\n    var body: some View {\n        NavigationStack {\n            List(sightings) { s in\n                VStack(alignment: .leading) {\n                    Text(s.species).font(.headline)\n                    Text(s.note).font(.subheadline).foregroundStyle(.secondary)\n                }\n            }\n            .navigationTitle("Today")\n        }\n    }\n}\n',
    } },
    { at: daysAgo(30, 20, 45), message: 'Upload client and offline sync queue', files: {
      'Fieldnote/Sync/UploadClient.swift': 'import Foundation\n\nstruct UploadClient {\n    var endpoint = URL(string: "https://api.fieldnote.app/v1/sightings")!\n\n    func upload(_ sighting: Sighting) async throws {\n        var request = URLRequest(url: endpoint)\n        request.httpMethod = "POST"\n        request.httpBody = try JSONEncoder().encode(sighting)\n        let (_, response) = try await URLSession.shared.data(for: request)\n        guard (response as? HTTPURLResponse)?.statusCode == 201 else { throw URLError(.badServerResponse) }\n    }\n}\n',
      'Fieldnote/Sync/SyncQueue.swift': syncQueueOriginal,
    } },
    { at: daysAgo(22, 22, 5), message: 'Voice capture: record and save audio with each sighting', files: {
      'Fieldnote/Voice/VoiceRecorder.swift': 'import AVFoundation\n\nfinal class VoiceRecorder {\n    private var recorder: AVAudioRecorder?\n\n    func start(to url: URL) throws {\n        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44_100, AVNumberOfChannelsKey: 1]\n        recorder = try AVAudioRecorder(url: url, settings: settings)\n        recorder?.record()\n    }\n\n    func stop() { recorder?.stop() }\n}\n',
    } },
    { at: daysAgo(12, 21, 30), message: 'Tests for SyncQueue enqueue and flush', files: {
      'FieldnoteTests/SyncQueueTests.swift': 'import XCTest\n@testable import Fieldnote\n\nfinal class SyncQueueTests: XCTestCase {\n    func testEnqueuePersists() {\n        let store = InMemoryStore()\n        let queue = SyncQueue(client: .init(), store: store)\n        queue.enqueue(.fixture)\n        XCTAssertEqual(store.pending.count, 1)\n    }\n}\n',
    } },
    { at: daysAgo(4, 22, 15), message: 'Onboarding: three screens, skip button', files: {
      'Fieldnote/Views/OnboardingView.swift': 'import SwiftUI\n\nstruct OnboardingView: View {\n    var body: some View {\n        TabView {\n            Text("Hear a bird? Just talk.")\n            Text("Works offline")\n            Text("Your life list")\n        }\n        .tabViewStyle(.page)\n    }\n}\n',
    } },
  ],
};

// ─── Fieldnote site ─────────────────────────────────────────────

const fieldnoteSite: AgentDef = {
  slug: 'fieldnote-site',
  name: 'Fieldnote site',
  emoji: '🌐',
  areaName: 'Fieldnote',
  purpose: 'fieldnote.app: the landing page, waitlist and privacy policy. Astro, deployed on Netlify.',
  instructions: 'Astro 5 with plain CSS. Keep the page under 100 KB. Use `pnpm dev` to preview on port 4321.',
  isGit: true,
  setupCommand: 'pnpm install',
  startCommand: 'pnpm dev --port $PORT',
  files: {
    'README.md': '# fieldnote.app\n\nAstro site for Fieldnote. `pnpm dev` to preview, `pnpm build` to deploy.\n',
    'package.json': JSON.stringify({ name: 'fieldnote-site', private: true, type: 'module', scripts: { dev: 'astro dev', build: 'astro build' }, dependencies: { astro: '^5.4.0' } }, null, 2) + '\n',
    'astro.config.mjs': "import { defineConfig } from 'astro/config';\n\nexport default defineConfig({ site: 'https://fieldnote.app' });\n",
    '.gitignore': 'node_modules/\ndist/\n.env\n',
    'src/pages/index.astro': "---\nimport Base from '../layouts/Base.astro';\n---\n<Base title=\"Fieldnote\">\n  <h1>Log birds by voice</h1>\n  <p>Coming soon.</p>\n</Base>\n",
    'src/layouts/Base.astro': "---\nconst { title } = Astro.props;\n---\n<html lang=\"en\">\n  <head><meta charset=\"utf-8\" /><title>{title}</title></head>\n  <body><slot /></body>\n</html>\n",
  },
  history: [
    { at: daysAgo(23, 19, 40), message: 'Netlify config and a proper base layout', files: {
      'netlify.toml': '[build]\n  command = "pnpm build"\n  publish = "dist"\n',
      'src/styles/global.css': ':root { --ink: #13201a; --leaf: #2f7d4f; --paper: #f6f4ee; }\nbody { margin: 0; font-family: system-ui, sans-serif; color: var(--ink); background: var(--paper); }\n',
    } },
  ],
};

// ─── Tidewater shop ─────────────────────────────────────────────

const tidewaterShop: AgentDef = {
  slug: 'tidewater-shop',
  name: 'Tidewater shop',
  emoji: '☕',
  areaName: 'Tidewater Coffee',
  purpose: 'Wholesale order form and subscription logic for Tidewater Coffee. TypeScript on Node, deployed as a small Fly app.',
  instructions:
    'TypeScript, strict. Prices are integers in cents. Wholesale minimum is 2 cases of 5 lb bags. ' +
    'Run `pnpm test` before finishing. Never email customers from a test.',
  isGit: true,
  setupCommand: 'pnpm install',
  startCommand: 'pnpm dev',
  files: {
    'README.md': '# Tidewater shop\n\nWholesale order form and subscriptions.\n\n- `src/pricing.ts` price sheet\n- `src/order-form.ts` wholesale order validation\n- `src/subscriptions.ts` subscription box\n',
    'package.json': JSON.stringify({ name: 'tidewater-shop', private: true, type: 'module', scripts: { dev: 'tsx watch src/server.ts', test: 'vitest run' }, dependencies: { hono: '^4.6.0' }, devDependencies: { tsx: '^4.19.0', typescript: '^5.6.0', vitest: '^2.1.0' } }, null, 2) + '\n',
    '.gitignore': 'node_modules/\n.env\n',
    'src/pricing.ts': "export const PRICE_PER_5LB_CENTS: Record<string, number> = {\n  'house-blend': 6200,\n  'guji-natural': 8400,\n  'huila-washed': 7300,\n  'decaf-swiss-water': 6900,\n};\n\nexport const CASE_BAGS = 4;\n",
  },
  history: [
    { at: daysAgo(37, 10, 20), message: 'Wholesale order form endpoint', files: {
      'src/order-form.ts': "import { PRICE_PER_5LB_CENTS, CASE_BAGS } from './pricing';\n\nexport interface OrderLine { sku: string; cases: number }\n\nexport function orderTotalCents(lines: OrderLine[]): number {\n  return lines.reduce((sum, l) => sum + (PRICE_PER_5LB_CENTS[l.sku] ?? 0) * CASE_BAGS * l.cases, 0);\n}\n",
      'src/server.ts': "import { Hono } from 'hono';\nimport { orderTotalCents } from './order-form';\n\nconst app = new Hono();\napp.post('/orders', async (c) => {\n  const body = await c.req.json();\n  return c.json({ totalCents: orderTotalCents(body.lines) }, 201);\n});\n\nexport default app;\n",
    } },
    { at: daysAgo(26, 9, 5), message: 'Subscription box: monthly plans', files: {
      'src/subscriptions.ts': "export type Plan = 'one-bag' | 'two-bag' | 'office';\n\nexport interface Subscription {\n  id: string;\n  customerEmail: string;\n  plan: Plan;\n  nextShipDate: string;\n  status: 'active' | 'paused' | 'cancelled';\n}\n\nexport function advanceShipDate(sub: Subscription): Subscription {\n  const d = new Date(sub.nextShipDate);\n  d.setMonth(d.getMonth() + 1);\n  return { ...sub, nextShipDate: d.toISOString().slice(0, 10) };\n}\n",
      'test/subscriptions.test.ts': "import { describe, expect, it } from 'vitest';\nimport { advanceShipDate } from '../src/subscriptions';\n\ndescribe('advanceShipDate', () => {\n  it('moves to the same day next month', () => {\n    expect(advanceShipDate({ id: 's1', customerEmail: 'a@b.c', plan: 'one-bag', nextShipDate: '2026-10-03', status: 'active' }).nextShipDate).toBe('2026-11-03');\n  });\n});\n",
    } },
  ],
};

// ─── Roast lab ──────────────────────────────────────────────────

const roastLab: AgentDef = {
  slug: 'roast-lab',
  name: 'Roast lab',
  emoji: '🔥',
  areaName: 'Tidewater Coffee',
  purpose: 'Analysis scripts for roast logs exported from Artisan: curves, development time, batch comparisons.',
  instructions: 'Python 3.12 with uv. Plots with matplotlib, dark background, temperatures in Fahrenheit. Keep raw logs in data/ untouched.',
  isGit: true,
  setupCommand: 'uv sync',
  files: {
    'README.md': '# Roast lab\n\nScripts for Artisan roast logs (`.alog`).\n\n```\nuv run python -m roastlab.parse_artisan data/2026-09-28-guji-natural.alog\n```\n',
    'pyproject.toml': '[project]\nname = "roastlab"\nversion = "0.1.0"\nrequires-python = ">=3.12"\ndependencies = ["matplotlib>=3.9", "numpy>=2.0"]\n',
    '.gitignore': '.venv/\n__pycache__/\nout/\n',
    'data/2026-09-28-guji-natural.alog': "{'roastertype': 'Loring S15', 'title': 'Guji natural 214', 'weight': [15.0, 12.8, 'Kg'], 'timex': [0, 4, 8, 12], 'temp1': [430, 428, 425, 421], 'temp2': [410, 352, 301, 262], 'computed': {'DRY_time': 388, 'FCs_time': 527, 'DROP_time': 652, 'DROP_BT': 412}}\n",
    'roastlab/__init__.py': '',
  },
  history: [
    { at: daysAgo(15, 16, 0), message: 'Parse Artisan alog files', files: {
      'roastlab/parse_artisan.py': 'import ast\nimport sys\nfrom pathlib import Path\n\n\ndef load(path: Path) -> dict:\n    """Artisan writes a Python literal, not JSON."""\n    return ast.literal_eval(path.read_text())\n\n\ndef summary(log: dict) -> str:\n    c = log["computed"]\n    dev = (c["DROP_time"] - c["FCs_time"]) / c["DROP_time"] * 100\n    return f"{log[\'title\']}: drop {c[\'DROP_time\'] // 60}:{c[\'DROP_time\'] % 60:02d} at {c[\'DROP_BT\']}F, development {dev:.1f}%"\n\n\nif __name__ == "__main__":\n    print(summary(load(Path(sys.argv[1]))))\n',
    } },
  ],
};

// ─── Household (no git) ─────────────────────────────────────────

const household: AgentDef = {
  slug: 'household',
  name: 'Household',
  emoji: '🗂️',
  areaName: 'Money',
  purpose: 'Household paperwork: taxes, insurance, the house. A plain folder of documents, no code.',
  instructions:
    'Never delete or move an original document. Make summaries as new Markdown files next to the originals. ' +
    'Account numbers stay masked to the last four digits.',
  isGit: false,
  files: {
    'README.md': '# Household\n\nPaperwork, organized by year and topic.\n',
    'taxes/2026/inbox/W-2 Theo Brandt (Linden USD).txt': 'Form W-2, Linden Unified School District\nEmployee: Theo Brandt\nWages: 71,480.00\nFederal withholding: 6,912.00\n',
    'taxes/2026/inbox/1099-K Square (Tidewater).txt': 'Form 1099-K\nPayee: Tidewater Coffee Co. LLC\nGross payments: 184,233.17\n',
    'taxes/2026/inbox/Mortgage interest 1098.txt': 'Form 1098\nLender: Linden Credit Union\nMortgage interest received: 9,402.55\nAccount ending 2291\n',
    'taxes/2026/inbox/Daycare receipts Q1-Q3.txt': 'Little Acorns After School\nRuby Brandt-Okafor\nJan to Sep: 3,240.00\n',
    'insurance/home/2025 declarations.txt': 'Harbor Mutual, policy HM-44821-B\nPremium 1,659.00\n',
    'house/panel-upgrade/quote-bright-spark.txt': 'Bright Spark Electric, Dana Whitfield\n200A panel upgrade with permit: 4,850.00\nValid 30 days\n',
  },
  history: [],
};

export const agents: AgentDef[] = [fieldnoteIos, fieldnoteSite, tidewaterShop, roastLab, household];

export interface BuiltProject {
  def: AgentDef;
  dir: string;
  remote: string | null;
}

/**
 * Create every project folder: initial files, the backdated history on
 * `main`, and a bare remote it's pushed to. Returns where each lives.
 */
export function buildProjects(seedRoot: string): Map<AgentSlug, BuiltProject> {
  const out = new Map<AgentSlug, BuiltProject>();
  fs.mkdirSync(path.join(seedRoot, 'remotes'), { recursive: true });
  for (const def of agents) {
    const dir = path.join(seedRoot, def.slug);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    writeFiles(dir, def.files);
    if (!def.isGit) {
      out.set(def.slug, { def, dir, remote: null });
      continue;
    }
    const firstAt = def.history[0] ? daysAgo(48, 20, 0) : daysAgo(30, 20, 0);
    git(dir, ['init', '-q', '-b', 'main']);
    commitAll(dir, 'Initial commit', firstAt);
    for (const c of def.history) {
      writeFiles(dir, c.files);
      commitAll(dir, c.message, c.at);
    }
    const remote = path.join(seedRoot, 'remotes', `${def.slug}.git`);
    fs.rmSync(remote, { recursive: true, force: true });
    git(seedRoot, ['init', '-q', '--bare', '-b', 'main', remote]);
    git(dir, ['remote', 'add', 'origin', remote]);
    git(dir, ['push', '-q', '-u', 'origin', 'main']);
    out.set(def.slug, { def, dir, remote });
  }
  return out;
}

export { syncQueueOriginal };
