import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerTerminals } from '@/lib/worker/terminals';

const requestWorker = vi.fn();
vi.mock('@/lib/workers/hub', () => ({
  requestWorker: (...args: unknown[]) => requestWorker(...args),
  WorkerUnavailableError: class extends Error {},
  WorkerRequestError: class extends Error { unsupported = false; },
}));
import { _resetRemoteTerminals, deliverTerminalOutput, remoteTerminalStream } from '@/lib/terminal/remote';

afterEach(() => { requestWorker.mockReset(); _resetRemoteTerminals(); });

describe('P3 independent terminal review', () => {
  it('sends final output received during replay before sending exit', async () => {
    let reply!: (x: unknown) => void;
    requestWorker.mockImplementationOnce(() => new Promise((r) => { reply = r; }));
    const res = remoteTerminalStream(new Request('http://test.invalid'), {
      computerId: 'laptop', computerName: 'Laptop',
      scope: { kind: 'execution', executionId: 'e1', generation: 1 },
    }, 't1');
    const text = res.text();
    // Snapshot was captured at offset 3. Its response is still in flight.
    deliverTerminalOutput('laptop', {
      chunks: [{ terminalId: 't1', data: 'FINAL', offset: 8 }],
      exits: [{ terminalId: 't1', code: 0, signal: null }],
    });
    reply({ status: 200, body: { replay: 'old', offset: 3, gap: false, exited: false, exitCode: null } });
    const wire = await text;
    expect(wire).toContain('event: exit');
    expect(wire).toContain('data: "FINAL"');
  });

  it('keeps a naturally exited execution shell replayable and closable', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-p3-exited-')));
    const batches: Array<{ exits: Array<{ terminalId: string }> }> = [];
    const scope = { kind: 'execution' as const, executionId: 'exited-shell', generation: 1 };
    const worker = new WorkerTerminals({
      journal: { preparedWorktree: () => root, highestGeneration: () => 1, released: () => false },
      agentFolder: () => root,
      post: async (batch) => { batches.push(batch); }, flushMs: 1,
    });
    try {
      const created = await worker.handle({ op: 'create', scope, cols: 80, rows: 24 });
      expect(created.status).toBe(201);
      const id = (created.body as { id: string }).id;
      await worker.handle({ op: 'input', scope, terminalId: id, data: 'printf final-result; exit\r' });
      for (let i = 0; i < 400 && !batches.some((b) => b.exits.some((e) => e.terminalId === id)); i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(batches.some((b) => b.exits.some((e) => e.terminalId === id))).toBe(true);
      const pty = await import('@/lib/terminal/pty-manager');
      expect(pty.getTerminal(scope.executionId, id)?.exited).toBe(true);
      expect.soft(await worker.handle({ op: 'replay', scope, terminalId: id })).toMatchObject({ status: 200, body: { exited: true } });
      // The UI calls close in its onExit handler. This must remove the tab.
      expect.soft(await worker.handle({ op: 'close', scope, terminalId: id })).toMatchObject({ status: 200 });
    } finally {
      await worker.closeAll();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
