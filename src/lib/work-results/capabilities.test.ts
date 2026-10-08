import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('result pilot admission and instruction discovery', () => {
  let root: string;
  let previous: string | undefined;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-result-gates-'));
    previous = process.env.RI_ROOT;
    process.env.RI_ROOT = root;
    vi.resetModules();
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.RI_ROOT;
    else process.env.RI_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('requires explicit independent opt-ins and never makes review available without handoffs', async () => {
    const gates = await import('./capabilities');
    expect(gates.getWorkResultCapabilities()).toEqual({ handoffsEnabled: false, aiReviewEnabled: false });
    expect(() => gates.assertHandoffsEnabled()).toThrow(/disabled/);
    gates.setWorkResultCapabilities({ aiReviewEnabled: true });
    expect(gates.getWorkResultCapabilities()).toEqual({ handoffsEnabled: false, aiReviewEnabled: false });
    gates.setWorkResultCapabilities({ handoffsEnabled: true });
    expect(gates.getWorkResultCapabilities()).toEqual({ handoffsEnabled: true, aiReviewEnabled: true });
    gates.setWorkResultCapabilities({ aiReviewEnabled: false });
    expect(gates.getWorkResultCapabilities()).toEqual({ handoffsEnabled: true, aiReviewEnabled: false });
    expect(() => gates.assertAiReviewEnabled()).toThrow(/disabled/);
  });

  it('delivers current enabled guidance to resumed sessions without treating normal messages as results', async () => {
    const gates = await import('./capabilities');
    const instructions = await import('./instructions');
    expect(instructions.workResultSessionInstructions('ri')).toBe('');
    expect(instructions.withWorkResultSessionInstructions('What changed?', null)).toBe('What changed?');
    gates.setWorkResultCapabilities({ handoffsEnabled: true });
    const handoff = instructions.workResultSessionInstructions('ri');
    expect(handoff).toContain('ri agent get_handoff_context');
    expect(handoff).toContain('Use ordinary chat for progress');
    expect(handoff).not.toContain('Upload an existing local screenshot');
    expect(handoff).not.toContain('request_result_review');
    gates.setWorkResultCapabilities({ aiReviewEnabled: true });
    expect(instructions.workResultSessionInstructions('ri')).not.toContain('request_result_review');
    expect(instructions.builtInHandoffInstructions('ri')).toContain('request_result_review');
    expect(instructions.withWorkResultSessionInstructions('Inspect this', 'result_review')).toBe('Inspect this');
    gates.setWorkResultCapabilities({ handoffsEnabled: false });
    expect(instructions.workResultSessionInstructions('ri')).toBe('');
  });
});
