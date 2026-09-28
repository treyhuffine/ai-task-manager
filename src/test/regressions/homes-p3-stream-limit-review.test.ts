/**
 * P3 review, finding 1: a page's streams used all six of the browser's
 * HTTP/1.1 connections to the home (the dashboard's, a chat's, one per
 * terminal tab), and every ordinary request waited behind them.
 *
 * The review's probe opened six raw EventSources itself, which only shows
 * the browser's limit: no change to the app could make it pass. Adapted to
 * the fix: the app opens one stream per page (`/api/live`), carrying the
 * dashboard's signals, each chat and each visible terminal. In real headless
 * Chromium, against the real route and real shells, a page following two
 * chats and four terminals holds one connection, their output arrives, and
 * an ordinary request goes straight through. Two such pages still leave
 * room.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright-core';
import { NextRequest } from 'next/server';
import { afterEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome | undefined;
afterEach(async () => {
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home?.cleanup();
});

it('follows two chats and four terminals over one connection, leaving the others free', async () => {
  home = await createTestHome({ prefix: 'ri-page-stream-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  const pty = await import('@/lib/terminal/pty-manager');
  const folder = path.join(home.root, 'work');
  fs.mkdirSync(folder, { recursive: true });
  const ws = q.createWorkspace({ name: 'Streams', cwd: folder, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const a = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'a' });
  const b = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'b' });
  const terminals = Array.from({ length: 4 }, () => pty.createTerminal({ ownerId: a.execution.id, cwd: folder }));
  for (const [i, t] of terminals.entries()) pty.writeInput(a.execution.id, t.id, `echo terminal-${i}-ok\r`);

  const { GET } = await import('@/app/api/live/route');
  let probeRequests = 0;
  let streams = 0;
  const open = new Set<http.ServerResponse>();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/probe') {
      probeRequests++;
      res.end('ok');
      return;
    }
    if (url.pathname !== '/api/live') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>page stream</title>');
      return;
    }
    streams++;
    open.add(res);
    const response = await GET(new NextRequest(url.toString()));
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.flushHeaders();
    const reader = response.body!.getReader();
    res.on('close', () => {
      open.delete(res);
      void reader.cancel();
    });
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        res.write(part.value);
      }
    } catch {
      /* cancelled */
    } finally {
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    executablePath: `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    headless: true,
  });
  try {
    const sub = {
      s: [[a.session.id, null], [b.session.id, null]],
      t: terminals.map((t) => [`/sessions/${a.session.id}`, t.id, null]),
    };
    const pages = [await browser.newPage(), await browser.newPage()];
    for (const page of pages) {
      await page.goto(base);
      await page.evaluate((url) => {
        const w = window as unknown as { frames: Array<{ event: string; data: string }>; source: EventSource };
        w.frames = [];
        w.source = new EventSource(url);
        for (const event of ['ready', 'session', 'terminal']) {
          w.source.addEventListener(event, (e) => w.frames.push({ event, data: (e as MessageEvent).data }));
        }
      }, `/api/live?sub=${encodeURIComponent(JSON.stringify(sub))}`);
    }
    // Each page: the global ready, both chats' ready, and every terminal's output.
    for (const page of pages) {
      await page.waitForFunction(
        (count) => {
          const frames = (window as unknown as { frames: Array<{ event: string; data: string }> }).frames;
          const chats = frames.filter((f) => f.event === 'session' && JSON.parse(f.data).e === 'ready').length;
          const text = frames.filter((f) => f.event === 'terminal').map((f) => JSON.stringify(JSON.parse(f.data).d)).join('');
          return frames.some((f) => f.event === 'ready') && chats === 2 && Array.from({ length: count }, (_, i) => text.includes(`terminal-${i}-ok`)).every(Boolean);
        },
        terminals.length,
        { timeout: 15_000 },
      );
    }
    expect(streams).toBe(2);
    // An ordinary request goes straight through.
    await pages[0]!.evaluate(() => fetch('/probe').then((r) => r.text()));
    expect(probeRequests).toBe(1);
  } finally {
    await browser.close();
    for (const res of open) res.destroy();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    for (const t of terminals) pty.killTerminal(a.execution.id, t.id);
  }
}, 40_000);
