import { describe, expect, it } from 'vitest';
import { ABOUT_MAX, aboutPrompt, tidyAbout } from './about-suggestion';

describe('tidyAbout', () => {
  it('keeps to the copy rule: no long dashes, no semicolons, one paragraph', () => {
    expect(tidyAbout("I'm building Ri — an agent-first app;\n and running a blog.")).toBe(
      "I'm building Ri, an agent-first app. and running a blog.",
    );
  });

  it('cuts a long draft at a sentence', () => {
    const long = `${'I build things. '.repeat(40)}`;
    const out = tidyAbout(long);
    expect(out.length).toBeLessThanOrEqual(ABOUT_MAX);
    expect(out.endsWith('.')).toBe(true);
  });
});

describe('aboutPrompt', () => {
  it('names the person and lists their projects with recent titles', () => {
    const prompt = aboutPrompt({
      userName: 'Trey',
      projects: [{ name: 'ai-task-manager', titles: ['Fix the rail', 'Add onboarding'] }, { name: 'blog', titles: [] }],
    });
    expect(prompt).toContain('Trey is setting up');
    expect(prompt).toContain('- ai-task-manager: Fix the rail | Add onboarding');
    expect(prompt).toContain('- blog');
  });
});
