/** Bounded packaged endurance and fault rehearsal. No host sleep, disk fill or
 * provider processes. RI_DESKTOP_ENDURANCE_CYCLES=1..10 (default 3).
 * RI_DESKTOP_ENDURANCE_CRASH_ONLY=1 is a calibration aid, not full acceptance.
 * RI_DESKTOP_PACKAGE=release/desktop/mac-arm64/Ri.app pnpm exec tsx desktop/endurance-smoke.ts */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { acceptance, api, bounded, eventually } from './acceptance-fixture';
import { serviceStatus } from '../src/lib/service/client';

const crashOnly = process.env.RI_DESKTOP_ENDURANCE_CRASH_ONLY === '1';
const cycles = Number(process.env.RI_DESKTOP_ENDURANCE_CYCLES ?? 3);
assert(Number.isInteger(cycles) && cycles >= 1 && cycles <= 10, 'RI_DESKTOP_ENDURANCE_CYCLES must be 1..10');

void acceptance('endurance-smoke', async fixture => {
  let page = await fixture.launch();
  const initial = await serviceStatus();
  assert(initial);
  const note = await api<{ id: string }>(page, '/api/notes', 'POST', { title: 'Endurance fixture', body: 'Before connection failures.' });
  const route = `/api/notes/${note.id}`;
  const samples: unknown[] = [];
  const heapSamples: number[] = [];

  for (let cycle = 0; cycle < (crashOnly ? 0 : cycles); cycle++) {
    if (cycle) page = await fixture.launch();
    assert.equal((await serviceStatus())?.runId, initial.runId, 'Viewer relaunch replaced the background service');
    assert.equal(fixture.origin, initial.origin, 'Viewer relaunch changed the stable origin');
    await fixture.navigate(`/note/${note.id}`);
    const title = page.locator('textarea.note-title');
    await title.waitFor();
    // Keep eight real streams open throughout foreground edits and a bounded
    // read/write burst. Release every reader even when a request fails.
    const load = page.evaluate(async ({ route, cycle }) => {
      const streams: EventSource[] = [];
      const durations: number[] = [];
      try {
        await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise<void>((resolve, reject) => {
          const stream = new EventSource(`/api/sessions/stream?endurance=${cycle}-${i}`);
          streams.push(stream);
          const timer = setTimeout(() => { stream.close(); reject(new Error('SSE readiness timeout')); }, 15_000);
          stream.addEventListener('ready', () => { clearTimeout(timer); resolve(); }, { once: true });
          stream.onerror = () => { clearTimeout(timer); reject(new Error('SSE connection failed')); };
        })));
        for (let batch = 0; batch < 5; batch++) {
          await Promise.all(Array.from({ length: 6 }, async (_, i) => {
            const start = performance.now();
            // Read-only requests can overlap editor writes without replacing
            // a document with an older API patch from the load generator.
            const response = await fetch(i % 2 ? route : '/api/health', { signal: AbortSignal.timeout(10_000) });
            if (!response.ok) throw new Error(`Foreground request failed: ${response.status}`);
            await response.text(); durations.push(performance.now() - start);
          }));
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return { streams: streams.filter(stream => stream.readyState === EventSource.OPEN).length, requests: durations.length, maxRequestMs: Math.round(Math.max(...durations)) };
      } finally { streams.forEach(stream => stream.close()); }
    }, { route, cycle });
    // Attach a handler immediately so an early load error cannot become an
    // unhandled rejection while the keyboard driver is still running.
    const loaded = load.then(value => ({ value }), error => ({ error }));
    const finalTitle = `Endurance cycle ${cycle + 1}: last edit`;
    for (let edit = 0; edit < 10; edit++) await title.fill(edit === 9 ? finalTitle : `Endurance cycle ${cycle + 1}: edit ${edit}`);
    const result = await loaded;
    if ('error' in result) throw result.error;
    assert.equal(result.value.streams, 8);
    assert.equal(result.value.requests, 30);
    await eventually(async () => (await api<{ title: string }>(page, route)).title === finalTitle, 'last foreground edit acknowledged under concurrent streams');
    const metrics = await fixture.app!.evaluate(({ app }) => app.getAppMetrics().map(metric => ({ type: metric.type, workingSetKiB: metric.memory.workingSetSize, cpuPercent: metric.cpu.percentCPUUsage })));
    const totalKiB = metrics.reduce((sum, item) => sum + item.workingSetKiB, 0);
    // This catches runaway allocation in the bounded fixture, not a promise
    // about OS-wide memory. Metrics exclude the detached Node service.
    assert(totalKiB < 2 * 1024 * 1024, `Desktop exceeded the fixture's 2 GiB working-set budget: ${totalKiB} KiB`);
    const cdp = await page.context().newCDPSession(page);
    const heap = await cdp.send('Runtime.getHeapUsage');
    await cdp.detach();
    heapSamples.push(heap.usedSize);
    samples.push({ cycle: cycle + 1, ...result.value, metrics, heapUsedBytes: heap.usedSize, sampledAt: new Date().toISOString() });

    // A renderer network interruption must show a reconnect state while the
    // detached service remains running, then recover without a new owner.
    await api(page, '/api/service');
    await page.context().setOffline(true);
    await page.getByRole('status').filter({ hasText: 'Reconnecting to Ri.' }).waitFor();
    assert.equal((await serviceStatus())?.runId, initial.runId);
    await page.context().setOffline(false);
    await page.getByRole('status').filter({ hasText: 'Reconnecting to Ri.' }).waitFor({ state: 'hidden' });
    await eventually(async () => (await api<{ title: string }>(page, route)).title === finalTitle, 'API recovered after renderer network interruption');
    await fixture.quit();
    assert.equal((await serviceStatus())?.runId, initial.runId, 'Closing the GUI stopped the daemon');
    fixture.check(`Cycle ${cycle + 1}: concurrent streams, repeated edits, bounded memory, reconnect, and GUI detach`);
  }
  fixture.report.cycles = crashOnly ? 0 : cycles;
  fixture.report.mode = crashOnly ? 'crash-only calibration' : 'full acceptance';
  fixture.report.resourceSamples = samples;
  // Fresh viewer processes should not retain previous renderer heaps. A large
  // per-launch growth trend deserves investigation even below the RSS cap.
  assert(crashOnly || heapSamples.at(-1)! - heapSamples[0] < 128 * 1024 * 1024, 'Fresh renderer heap grew by more than 128 MiB across bounded cycles');

  if (!crashOnly) page = await fixture.launch();
  await fixture.navigate(`/note/${note.id}`);
  await page.locator('textarea.note-title').waitFor();
  const before = await api<{ title: string }>(page, route);
  const retainedTitle = 'Unacknowledged editor text survives renderer crash';
  // Fail only this fixture document's save, while allowing independent reads
  // to prove SQLite still contains the last acknowledged value.
  await page.route(`**${route}`, route => route.request().method() === 'PATCH' ? route.abort('connectionrefused') : route.continue());
  const failedWrite = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname === route && request.method() === 'PATCH' });
  await page.locator('textarea.note-title').fill(retainedTitle);
  await failedWrite;
  assert.equal((await api<{ title: string }>(page, route)).title, before.title);
  assert(await page.evaluate(title => Object.keys(localStorage).some(key => key.startsWith('ri:document-draft:v1:') && localStorage.getItem(key)?.includes(title)), retainedTitle));
  await page.unrouteAll({ behavior: 'wait' });
  // A crashed Playwright Page can no longer answer intercepted requests.
  // Remove CDP routing before testing Electron's autonomous recovery. This
  // home still has no provider credentials or harnesses on PATH.
  // Select Reload in the app's real crash-recovery dialog, without requiring
  // a human to dismiss a native modal in automation.
  await fixture.app!.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox;
    dialog.showMessageBox = ((...args: unknown[]) => {
      if ((args.at(-1) as { message?: string }).message === 'Ri’s window stopped responding') return Promise.resolve({ response: 0, checkboxChecked: false });
      return original(...args as Parameters<typeof original>);
    }) as typeof original;
  });
  // Playwright permanently marks a Page crashed. Observe the app's own
  // reload from Electron main before reopening only to attach a fresh driver.
  const recovered = await bounded(fixture.app!.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const contents = window.webContents;
    const before = { windowId: window.id, contentsId: contents.id, rendererPid: contents.getOSProcessId(), url: contents.getURL() };
    const events: unknown[] = [];
    contents.on('did-start-navigation', (_event, url, _inPlace, mainFrame) => { if (mainFrame) events.push({ event: 'did-start-navigation', url }); });
    contents.on('did-fail-load', (_event, code, description, url, mainFrame) => { if (mainFrame) events.push({ event: 'did-fail-load', code, description, url }); });
    contents.on('did-stop-loading', () => { events.push({ event: 'did-stop-loading', url: contents.getURL() }); });
    let didFinishLoad = false;
    let crashReason: string | undefined;
    contents.once('did-finish-load', () => { didFinishLoad = true; });
    contents.once('render-process-gone', (_event, details) => { crashReason = details.reason; });
    {
      contents.forcefullyCrashRenderer();
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        if (didFinishLoad && !contents.isDestroyed() && !contents.isCrashed()) {
          // The marker confirms the renderer has installed its save/close
          // bridge. Main-process DOM access remains usable after CDP crash.
          let timer: ReturnType<typeof setTimeout> | undefined;
          const document = await Promise.race([
            contents.executeJavaScript(`(() => ({ url: location.href, readyState: document.readyState, desktop: document.documentElement.dataset.riDesktop, hasRail: [...document.querySelectorAll('aside')].some(element => element.getBoundingClientRect().width > 0), hasComposer: !!document.querySelector('[contenteditable="true"][aria-label]') }))()`),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Recovered renderer DOM timed out')), 5_000); }),
          ]).finally(() => clearTimeout(timer)) as { url: string; readyState: string; desktop?: string; hasRail: boolean; hasComposer: boolean };
          if (document.desktop === process.platform && document.hasRail && document.hasComposer) {
            const healthStatus = await contents.executeJavaScript("fetch('/api/health', { signal: AbortSignal.timeout(5000) }).then(response => response.status)") as number;
            if (healthStatus !== 200) throw new Error(`Recovered renderer health request failed: ${healthStatus}`);
            return {
              before, after: { windowId: window.id, contentsId: contents.id, rendererPid: contents.getOSProcessId(), url: contents.getURL() },
              didFinishLoad, crashReason, document, healthStatus, events,
            };
          }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Native crash reload failed: ${JSON.stringify({ before, didFinishLoad, crashReason, events, currentUrl: contents.getURL(), crashed: contents.isCrashed() })}`);
    }
  }), 'same-window native crash recovery', 55_000);
  assert.equal(recovered.after.windowId, recovered.before.windowId);
  assert.equal(recovered.after.contentsId, recovered.before.contentsId);
  assert.notEqual(recovered.after.rendererPid, recovered.before.rendererPid);
  assert.equal(new URL(recovered.after.url).pathname, '/');
  assert.equal(recovered.didFinishLoad, true);
  assert(recovered.crashReason);
  assert.equal((await serviceStatus())?.runId, initial.runId);
  fixture.report.crashRecovery = { ...recovered, serviceRunId: initial.runId, driverReattachedByViewerRelaunch: true };
  const screenshot = await bounded(fixture.app!.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')), 'native recovery screenshot', 10_000);
  fs.writeFileSync(path.join(fixture.base, 'crash-recovered.png'), Buffer.from(screenshot, 'base64'));
  fixture.check('App reloads the crashed renderer in the existing window with the same daemon');
  fixture.page = undefined;
  await fixture.quit();
  page = await fixture.launch();
  assert.equal((await serviceStatus())?.runId, initial.runId);
  await fixture.navigate(`/note/${note.id}`);
  const restore = page.getByRole('button', { name: 'Restore draft', exact: true });
  await restore.waitFor();
  assert.equal((await api<{ title: string }>(page, route)).title, before.title, 'Retained draft replayed without consent');
  await restore.click();
  await eventually(async () => (await api<{ title: string }>(page, route)).title === retainedTitle, 'explicit restoration of draft after renderer crash');
  assert.equal(await page.locator('textarea.note-title').inputValue(), retainedTitle);
  fixture.check('Failed save, renderer crash, same daemon, retained draft, and explicit restoration');
  fixture.report.limits = ['Bounded cycles, not an overnight soak.', 'No host sleep/reboot/login, real disk exhaustion, OS resource pressure, or external provider calls.', 'Working-set samples cover Electron processes. Detached service liveness is checked separately.'];
  await page.screenshot({ path: path.join(fixture.base, 'endurance.png') });
}).catch(error => { console.error(error); process.exitCode = 1; });
