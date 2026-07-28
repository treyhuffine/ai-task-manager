import { describe, it, expect } from 'vitest';
import {
  applyPick,
  canLaunch,
  chipsForItem,
  composePrompt,
  continuationOf,
  removeChip,
  resolveBase,
  type LaunchSourceItem,
} from './launch-draft';

const pr = (n: number, title = 'Fix auth token refresh'): LaunchSourceItem => ({
  kind: 'pr',
  key: String(n),
  number: n,
  title,
  ref: 'feat/auth',
  body: 'Refresh races on 401.',
});

const issue = (n: number): LaunchSourceItem => ({
  kind: 'issue',
  key: String(n),
  number: n,
  title: 'Auth fails after tunnel restart',
  body: 'Steps to reproduce…',
});

const branch = (name: string): LaunchSourceItem => ({
  kind: 'branch',
  key: name,
  title: name,
  ref: name,
});

const task = (title: string): LaunchSourceItem => ({
  kind: 'task',
  key: `t-${title}`,
  title,
  subtitle: 'deck · today',
  body: 'Notes on the handshake.',
});

const chat = (id: string, archived = false): LaunchSourceItem => ({
  kind: 'chat',
  key: id,
  sessionId: id,
  archived,
  title: 'Remote base URL work',
  subtitle: '…bearer token…',
});

const external = (key: string): LaunchSourceItem => ({
  kind: 'external',
  key,
  externalKey: key,
  externalSource: 'claude',
  title: 'Auth bootstrap rewrite',
});

describe('chipsForItem', () => {
  it('fans a PR into a base chip and a context chip', () => {
    const chips = chipsForItem(pr(402));
    expect(chips.map((c) => c.chipKind)).toEqual(['base', 'context']);
    expect(chips[0].base).toEqual({ baseBranch: null, prNumber: 402 });
    expect(chips[0].label).toBe('pr/402');
    expect(chips[1].context?.heading).toBe('Pull request #402: Fix auth token refresh');
  });

  it('treats an issue as context only — it has no head ref to fork from', () => {
    const chips = chipsForItem(issue(377));
    expect(chips).toHaveLength(1);
    expect(chips[0].chipKind).toBe('context');
  });

  it('treats a branch as base only — there is no body to quote', () => {
    const chips = chipsForItem(branch('feat/auth-rework'));
    expect(chips).toHaveLength(1);
    expect(chips[0].chipKind).toBe('base');
    expect(chips[0].base).toEqual({ baseBranch: 'feat/auth-rework', prNumber: null });
  });

  it('flags a PR with no description instead of emitting an empty block', () => {
    const chips = chipsForItem({ ...pr(1), body: '   ' });
    expect(chips[1].detail).toBe('no description');
  });
});

describe('applyPick', () => {
  it('keeps only one base chip — a second pick replaces the first', () => {
    let chips = applyPick([], branch('main'));
    chips = applyPick(chips, branch('staging'));
    const bases = chips.filter((c) => c.chipKind === 'base');
    expect(bases).toHaveLength(1);
    expect(bases[0].base?.baseBranch).toBe('staging');
  });

  it('accumulates context chips', () => {
    let chips = applyPick([], issue(377));
    chips = applyPick(chips, task('Rework beamd auth handshake'));
    expect(chips.filter((c) => c.chipKind === 'context')).toHaveLength(2);
  });

  it('is idempotent — re-picking the same item does not duplicate', () => {
    let chips = applyPick([], pr(402));
    chips = applyPick(chips, pr(402));
    expect(chips).toHaveLength(2);
  });

  it('drops the base when a continuation is attached', () => {
    let chips = applyPick([], pr(402));
    chips = applyPick(chips, chat('s1'));
    expect(chips.some((c) => c.chipKind === 'base')).toBe(false);
    expect(continuationOf(chips)?.sessionId).toBe('s1');
    // Context survives — quoting a PR into a continued chat is still valid.
    expect(chips.some((c) => c.chipKind === 'context')).toBe(true);
  });

  it('drops the continuation when a base is attached', () => {
    let chips = applyPick([], chat('s1'));
    chips = applyPick(chips, branch('main'));
    expect(continuationOf(chips)).toBeNull();
    expect(resolveBase(chips).baseBranch).toBe('main');
  });

  it('keeps only one continuation', () => {
    let chips = applyPick([], chat('s1'));
    chips = applyPick(chips, external('claude:abc'));
    expect(chips.filter((c) => c.chipKind === 'continue')).toHaveLength(1);
    expect(continuationOf(chips)).toEqual({
      sessionId: null,
      externalKey: 'claude:abc',
      externalSource: 'claude',
      // Freshly-adopted provider sessions always land archived.
      archived: true,
    });
  });
});

describe('continuationOf', () => {
  it('carries the archived flag so the launcher knows to reactivate first', () => {
    expect(continuationOf(applyPick([], chat('s1', true)))?.archived).toBe(true);
    expect(continuationOf(applyPick([], chat('s2', false)))?.archived).toBe(false);
  });
});

describe('removeChip', () => {
  it('drops the base half of a PR pick, leaving the context half', () => {
    const chips = applyPick([], pr(402));
    const base = chips.find((c) => c.chipKind === 'base')!;
    const rest = removeChip(chips, base.id);
    expect(resolveBase(rest)).toEqual({ baseBranch: null, prNumber: null });
    expect(rest.some((c) => c.chipKind === 'context')).toBe(true);
  });
});

describe('resolveBase', () => {
  it('returns an empty base when nothing is attached', () => {
    expect(resolveBase([])).toEqual({ baseBranch: null, prNumber: null });
  });
});

describe('composePrompt', () => {
  it('returns typed text verbatim when there is no context', () => {
    expect(composePrompt('  fix the race  ', [])).toBe('fix the race');
    expect(composePrompt('fix the race', applyPick([], branch('main')))).toBe('fix the race');
  });

  it('appends one block per context chip', () => {
    const chips = applyPick(applyPick([], issue(377)), task('Rework handshake'));
    const out = composePrompt('start here', chips);
    expect(out).toBe(
      [
        'start here',
        '',
        '## Context',
        '',
        '### Issue #377: Auth fails after tunnel restart',
        '',
        'Steps to reproduce…',
        '',
        '### Task: Rework handshake',
        '',
        'Notes on the handshake.',
      ].join('\n'),
    );
  });

  it('omits the body line for a context chip with no body', () => {
    const chips = applyPick([], { ...issue(1), body: null });
    expect(composePrompt('go', chips)).toBe('go\n\n## Context\n\n### Issue #1: Auth fails after tunnel restart');
  });

  it('works with an empty prompt (context-only launch)', () => {
    const chips = applyPick([], { ...issue(9), body: null });
    expect(composePrompt('   ', chips)).toBe('## Context\n\n### Issue #9: Auth fails after tunnel restart');
  });
});

describe('canLaunch', () => {
  it('requires text or context', () => {
    expect(canLaunch('', [])).toBe(false);
    expect(canLaunch('  ', [])).toBe(false);
    expect(canLaunch('do it', [])).toBe(true);
    expect(canLaunch('', applyPick([], issue(1)))).toBe(true);
  });

  it('does not treat a bare base chip as launchable', () => {
    // Forking a worktree with no instruction is not a complete thought.
    expect(canLaunch('', applyPick([], branch('main')))).toBe(false);
  });
});

describe('connector tasks', () => {
  const connectorTask = (label: string): LaunchSourceItem => ({
    kind: 'connector',
    key: `todoist:99`,
    title: 'Renew domain',
    subtitle: 'Todoist · tomorrow',
    body: 'Registrar auto-renew is off.',
    providerLabel: label,
  });

  it('attaches as context and names its provider in the heading', () => {
    const chips = chipsForItem(connectorTask('Todoist'));
    expect(chips).toHaveLength(1);
    expect(chips[0].chipKind).toBe('context');
    // The agent must be able to tell an external task from a local one, since
    // it can't edit the former through this app's own task tools.
    expect(chips[0].context?.heading).toBe('Todoist task: Renew domain');
  });

  it('falls back to a neutral prefix when the provider is unknown', () => {
    const chips = chipsForItem({ ...connectorTask('Todoist'), providerLabel: null });
    expect(chips[0].context?.heading).toBe('External task: Renew domain');
  });

  it('composes into the prompt alongside a local task', () => {
    const chips = applyPick(applyPick([], task('Local one')), connectorTask('Linear'));
    const out = composePrompt('do both', chips);
    expect(out).toContain('### Task: Local one');
    expect(out).toContain('### Linear task: Renew domain');
  });
});
