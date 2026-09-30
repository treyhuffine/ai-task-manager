import { describe, expect, it } from 'vitest';
import {
  checkSkill,
  nameProblem,
  parseSkillFile,
  renderSkillFile,
  suggestSkillName,
  DESCRIPTION_MAX,
} from './format';

const BASIC = `---
name: review-prs
description: Review pull requests. Use when the user asks for a review.
---
# Review

Read the diff first.
`;

const RICH = `---
# kept: a comment the author wrote
name: review-prs
description: 'Review pull requests: carefully'
license: Apache-2.0
allowed-tools: Bash(git:*) Read
metadata:
  author: trey
  version: "1.0"
---

Body with --- inside it
---
and a fence-looking line.
`;

describe('parseSkillFile', () => {
  it('splits fields and keeps the body verbatim', () => {
    const parsed = parseSkillFile(BASIC);
    expect(parsed.name).toBe('review-prs');
    expect(parsed.description).toBe('Review pull requests. Use when the user asks for a review.');
    expect(parsed.body).toBe('# Review\n\nRead the diff first.\n');
    expect(parsed.otherKeys).toEqual([]);
    expect(parsed.frontmatterError).toBeNull();
  });

  it('lists the other keys in file order and only closes on the first fence', () => {
    const parsed = parseSkillFile(RICH);
    expect(parsed.otherKeys).toEqual(['license', 'allowed-tools', 'metadata']);
    expect(parsed.body).toBe('\nBody with --- inside it\n---\nand a fence-looking line.\n');
  });

  it('reads CRLF files and a byte-order mark', () => {
    const parsed = parseSkillFile('﻿---\r\nname: x\r\ndescription: y\r\n---\r\nbody\r\n');
    expect(parsed.name).toBe('x');
    expect(parsed.body).toBe('body\r\n');
  });

  it('explains a missing, unterminated, invalid or non-mapping frontmatter', () => {
    expect(parseSkillFile('# just markdown\n').frontmatterError).toMatch(/no frontmatter/);
    expect(parseSkillFile('# just markdown\n').body).toBe('# just markdown\n');
    expect(parseSkillFile('---\nname: x\n').frontmatterError).toMatch(/never closes/);
    expect(parseSkillFile('---\nname: [unclosed\n---\n').frontmatterError).toMatch(/isn't valid YAML/);
    expect(parseSkillFile('---\n- a\n- b\n---\n').frontmatterError).toMatch(/key: value/);
  });

  it('treats an empty frontmatter as fields that are simply missing', () => {
    const parsed = parseSkillFile('---\n---\nbody\n');
    expect(parsed.frontmatterError).toBeNull();
    expect(parsed.name).toBeNull();
    expect(parsed.body).toBe('body\n');
  });
});

describe('renderSkillFile', () => {
  it('replaces only the body, leaving the frontmatter bytes alone', () => {
    const out = renderSkillFile(RICH, { body: 'New body.\n' });
    expect(out).toBe(RICH.slice(0, RICH.indexOf('---\n\nBody') + 4) + 'New body.\n');
  });

  it('is a no-op when fields are unchanged', () => {
    expect(renderSkillFile(RICH, { name: 'review-prs', description: 'Review pull requests: carefully' })).toBe(RICH);
  });

  it('changes the description and keeps comments, order, other keys and the body', () => {
    const out = renderSkillFile(RICH, { description: 'Review PRs. Use when asked: "review this".' });
    const parsed = parseSkillFile(out);
    expect(parsed.description).toBe('Review PRs. Use when asked: "review this".');
    expect(parsed.otherKeys).toEqual(['license', 'allowed-tools', 'metadata']);
    expect(out).toContain('# kept: a comment the author wrote');
    expect(out).toContain('version: "1.0"');
    expect(parsed.body).toBe(parseSkillFile(RICH).body);
    expect(out.indexOf('name:')).toBeLessThan(out.indexOf('description:'));
    expect(out.indexOf('description:')).toBeLessThan(out.indexOf('license:'));
  });

  it('never folds a long description across lines', () => {
    const long = 'word '.repeat(150).trim();
    const out = renderSkillFile(BASIC, { description: long });
    const line = out.split('\n').find((l) => l.startsWith('description:'));
    expect(line).toBe(`description: ${long}`);
    expect(parseSkillFile(out).description).toBe(long);
  });

  it('adds a missing description right after the name', () => {
    const out = renderSkillFile('---\nname: a\nlicense: MIT\n---\nbody\n', { description: 'Does a.' });
    expect(out).toBe('---\nname: a\ndescription: Does a.\nlicense: MIT\n---\nbody\n');
  });

  it('adds a missing name at the top', () => {
    const out = renderSkillFile('---\nlicense: MIT\n---\nbody\n', { name: 'a' });
    expect(out).toBe('---\nname: a\nlicense: MIT\n---\nbody\n');
  });

  it('renames in place', () => {
    const out = renderSkillFile(BASIC, { name: 'review-pull-requests' });
    expect(parseSkillFile(out).name).toBe('review-pull-requests');
    expect(parseSkillFile(out).body).toBe(parseSkillFile(BASIC).body);
  });

  it('writes a fresh file when there is nothing to keep', () => {
    expect(renderSkillFile(null, { name: 'a', description: 'Does a.', body: '# A\n' })).toBe(
      '---\nname: a\ndescription: Does a.\n---\n# A\n',
    );
    const rebuilt = renderSkillFile('no frontmatter here\n', { name: 'a', description: 'Does a.' });
    expect(rebuilt).toBe('---\nname: a\ndescription: Does a.\n---\nno frontmatter here\n');
  });

  it('keeps CRLF line endings when it rewrites the frontmatter', () => {
    const out = renderSkillFile('---\r\nname: a\r\ndescription: old\r\n---\r\nbody\r\n', { description: 'new' });
    expect(out).toBe('---\r\nname: a\r\ndescription: new\r\n---\r\nbody\r\n');
  });
});

describe('nameProblem', () => {
  it.each(['a', 'pdf-processing', 'code-review-2', 'x'.repeat(64)])('accepts %s', (name) => {
    expect(nameProblem(name)).toBeNull();
  });

  it.each([
    ['', /Give it a name/],
    ['x'.repeat(65), /64 characters/],
    ['PDF-Processing', /lowercase/],
    ['-pdf', /lowercase/],
    ['pdf-', /lowercase/],
    ['pdf--processing', /lowercase/],
    ['pdf_processing', /lowercase/],
    ['pdf processing', /lowercase/],
  ])('rejects %j', (name, message) => {
    expect(nameProblem(name)).toMatch(message);
  });
});

describe('checkSkill', () => {
  it('passes a well-formed skill', () => {
    expect(checkSkill(parseSkillFile(BASIC), 'review-prs')).toEqual([]);
  });

  it('flags a name that does not match its folder', () => {
    const problems = checkSkill(parseSkillFile(BASIC), 'other');
    expect(problems).toEqual([
      expect.objectContaining({ field: 'name', level: 'error', message: expect.stringMatching(/folder is other/) }),
    ]);
  });

  it('requires a description and caps its length', () => {
    const missing = checkSkill(parseSkillFile('---\nname: a\n---\nbody\n'), 'a');
    expect(missing).toEqual([expect.objectContaining({ field: 'description', level: 'error' })]);
    const long = renderSkillFile(BASIC, { description: 'x'.repeat(DESCRIPTION_MAX + 1) });
    expect(checkSkill(parseSkillFile(long), 'review-prs')).toEqual([
      expect.objectContaining({ field: 'description', level: 'error', message: expect.stringMatching(/1,025/) }),
    ]);
  });

  it('warns, without blocking, on an empty or very long body', () => {
    const empty = checkSkill(parseSkillFile('---\nname: a\ndescription: b\n---\n'), 'a');
    expect(empty).toEqual([expect.objectContaining({ field: 'body', level: 'warning' })]);
    const long = checkSkill(parseSkillFile(`---\nname: a\ndescription: b\n---\n${'line\n'.repeat(600)}`), 'a');
    expect(long).toEqual([expect.objectContaining({ field: 'body', level: 'warning', message: expect.stringMatching(/references/) })]);
  });

  it('reports only the frontmatter when it cannot be read', () => {
    expect(checkSkill(parseSkillFile('body only\n'), 'a')).toEqual([
      expect.objectContaining({ field: 'frontmatter', level: 'error' }),
    ]);
  });
});

describe('suggestSkillName', () => {
  it('takes the first meaningful words', () => {
    expect(suggestSkillName('Help me review Medium article submissions and draft replies')).toBe(
      'review-medium-article-submissions',
    );
  });

  it('skips question words, so a sentence names the skill by its subject', () => {
    expect(suggestSkillName('Every Friday, review my week: what got done and what slipped')).toBe('friday-review-week-got');
  });

  it('strips accents and symbols', () => {
    expect(suggestSkillName('Résumé tailoring for job posts!')).toBe('resume-tailoring-job-posts');
  });

  it('falls back when nothing is left', () => {
    expect(suggestSkillName('   ')).toBe('new-skill');
    expect(suggestSkillName('help me with this please')).toBe('new-skill');
  });

  it('never returns a taken name', () => {
    const taken = new Set(['triage-inbox', 'triage-inbox-2']);
    expect(suggestSkillName('triage inbox', taken)).toBe('triage-inbox-3');
  });

  it('always returns a valid name', () => {
    for (const intent of ['x'.repeat(200), 'a-b c--d', '123 go', 'ÆØÅ ok']) {
      expect(nameProblem(suggestSkillName(intent))).toBeNull();
    }
  });
});
