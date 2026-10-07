import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commitsForRange, parseCommitList } from './commits';
import { HUMAN_LINES_PER_HOUR } from './lines';

const US = '\u001f';

describe('parseCommitList', () => {
  it('reads hash, time and subject, a pipe in the subject included', () => {
    expect(parseCommitList(`abc${US}2026-10-01T09:30:00-07:00${US}fix: a | pipe\n\n`)).toEqual([
      { hash: 'abc', at: '2026-10-01T09:30:00-07:00', subject: 'fix: a | pipe' },
    ]);
    expect(parseCommitList('')).toEqual([]);
  });
});

describe('commitsForRange, against a real repo', () => {
  let repo: string;
  const me = 'me@ri.local';
  const run = (args: string[], at = '2026-09-20T12:00:00Z', email = me) =>
    execFileSync('git', args, {
      cwd: repo,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        HOME: repo,
        GIT_AUTHOR_NAME: 'Someone',
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: 'Someone',
        GIT_COMMITTER_EMAIL: email,
        GIT_AUTHOR_DATE: at,
        GIT_COMMITTER_DATE: at,
      },
    }).toString();
  const write = (file: string, lines: string[]) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), `${lines.join('\n')}\n`);
  };
  const commit = (message: string, at: string, email = me) => {
    run(['add', '-A'], at, email);
    run(['commit', '-q', '-m', message], at, email);
  };
  const code = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `export const ${prefix}${i} = ${i};`);

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-work-commits-'));
    run(['init', '-q', '-b', 'main']);
    run(['config', 'user.email', me]);
    write('README.md', ['# repo']);
    commit('initial', '2026-09-20T12:00:00Z');

    // Last week, on a branch: 300 lines.
    run(['checkout', '-q', '-b', 'feature']);
    write('src/feature.ts', code(300, 'f'));
    commit('feat: the feature', '2026-09-25T12:00:00Z');

    // This week: the branch squashed onto main, plus 20 new lines.
    run(['checkout', '-q', 'main']);
    write('src/feature.ts', [...code(300, 'f'), ...code(20, 'landing')]);
    commit('feat: the feature (squashed)', '2026-10-01T12:00:00Z');

    // A refactor moves 100 lines into a new file and writes 10.
    write('src/feature.ts', [...code(200, 'f'), ...code(20, 'landing')]);
    write('src/split.ts', [...code(300, 'f').slice(200), ...code(10, 'split')]);
    commit('refactor: split the feature', '2026-10-02T12:00:00Z');

    // A teammate's commit doesn't count.
    write('src/theirs.ts', code(500, 't'));
    commit('feat: theirs', '2026-10-02T13:00:00Z', 'teammate@ri.local');
  });

  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('counts the lines each commit wrote, once, and only yours', async () => {
    const week = await commitsForRange([{ cwd: repo, agentIds: ['a1'] }], '2026-09-28T00:00:00.000Z', '2026-10-05T00:00:00.000Z');
    expect(week.map((c) => [c.subject, c.lines])).toEqual([
      ['refactor: split the feature', 10],
      ['feat: the feature (squashed)', 20],
    ]);
    expect(week[1]!.effortHours).toBe(20 / HUMAN_LINES_PER_HOUR);

    const lastWeek = await commitsForRange([{ cwd: repo, agentIds: ['a1'] }], '2026-09-21T00:00:00.000Z', '2026-09-28T00:00:00.000Z');
    expect(lastWeek.map((c) => [c.subject, c.lines])).toEqual([['feat: the feature', 300]]);
  });
});
