import { describe, it, expect } from 'vitest';
import {
  describeToolCall,
  describeToolResult,
  basename,
  isSubagentTool,
  isPlumbingTool,
} from './tool-display';

describe('basename', () => {
  it('returns the last path segment', () => {
    expect(basename('/a/b/TickerRow.tsx')).toBe('TickerRow.tsx');
    expect(basename('TickerRow.tsx')).toBe('TickerRow.tsx');
    expect(basename('/a/b/')).toBe('b');
  });
});

describe('describeToolCall', () => {
  it('humanizes Read with a file basename target', () => {
    const d = describeToolCall('Read', { file_path: '/repo/src/screens/TickerRow.tsx' });
    expect(d).toMatchObject({ glyph: 'read', verb: 'Read', target: 'TickerRow.tsx' });
  });

  it('uses the Bash description as the verb and the command as detail', () => {
    const d = describeToolCall('Bash', { command: 'ls emailalerts/utils/', description: 'List utils contents' });
    expect(d.glyph).toBe('bash');
    expect(d.verb).toBe('List utils contents');
    expect(d.detail).toBe('ls emailalerts/utils/');
  });

  it('falls back to a generic verb for Bash without a description', () => {
    const d = describeToolCall('Bash', { command: 'git status' });
    expect(d.verb).toBe('Run');
    expect(d.mono).toBe(true);
    expect(d.detail).toBe('git status');
  });

  it('keeps MCP tools as a monospace prettified name', () => {
    const d = describeToolCall('mcp__playwright__browser_navigate', { url: 'https://x.test/a' });
    expect(d.mono).toBe(true);
    // server prefix split out; tool id kept intact (recognizable / searchable)
    expect(d.verb).toBe('playwright: browser_navigate');
  });

  it('marks Task as a subagent', () => {
    const d = describeToolCall('Task', { description: 'Map the codebase', subagent_type: 'Explore' });
    expect(d.glyph).toBe('task');
    expect(d.target).toBe('Map the codebase');
    expect(isSubagentTool('Task')).toBe(true);
    expect(isSubagentTool('Bash')).toBe(false);
  });

  it('describes an Agent launch by its description, not its raw prompt', () => {
    // `Agent` is what current Claude builds emit. Falling through to the
    // default branch rendered a fragment of the prompt as the target.
    const d = describeToolCall('Agent', {
      subagent_type: 'Explore',
      description: 'Find playbank page implementation',
      prompt: 'I need to understand the /playbook/playbank page...',
    });
    expect(d.glyph).toBe('task');
    expect(d.verb).toBe('Subagent');
    expect(d.kind).toBe('subagent');
    expect(d.target).toBe('Find playbank page implementation');
  });

  it('falls back to the subagent type when no description is given', () => {
    const d = describeToolCall('Agent', { subagent_type: 'Explore' });
    expect(d.target).toBe('Explore');
  });

  it("labels a Codex spawn_agent by task name, since its message is encrypted", () => {
    const d = describeToolCall('spawn_agent', {
      task_name: 'git_history',
      message: 'gAAAAABqX8eKimif7x6en6knzV7tLfE2fv8lly...',
    });
    expect(d.verb).toBe('Subagent');
    expect(d.target).toBe('git_history');
  });

  it('recognizes the subagent tool names providers actually emit', () => {
    // `Task` is the historical Claude name; current builds emit `Agent`, and
    // every subagent launch in the corpus uses it. Codex spawns via
    // `spawn_agent`. Missing these meant no launch was ever counted as a
    // subagent, and nothing anchored a subagent's nested transcript.
    expect(isSubagentTool('Agent')).toBe(true);
    expect(isSubagentTool('spawn_agent')).toBe(true);
  });

  it('excludes tools that only query existing children', () => {
    // `wait_agent`/`list_agents` reference a child rather than creating one.
    // Counting them would inflate the subagent tally and give two rows a
    // claim on the same child's events.
    expect(isSubagentTool('wait_agent')).toBe(false);
    expect(isSubagentTool('list_agents')).toBe(false);
    expect(isSubagentTool(null)).toBe(false);
    expect(isSubagentTool(undefined)).toBe(false);
  });

  it('handles unknown tools without throwing', () => {
    const d = describeToolCall('SomethingNew', {});
    expect(d.verb).toBe('SomethingNew');
    expect(d.mono).toBe(true);
  });
});

describe('describeToolCall — Codex', () => {
  it('handles live command_execution (input is the command string)', () => {
    const d = describeToolCall('command_execution', 'git status --short');
    expect(d).toMatchObject({ glyph: 'bash', kind: 'exec', mono: true, detail: 'git status --short' });
  });

  it('handles on-disk exec_command ({ cmd })', () => {
    const d = describeToolCall('exec_command', { cmd: 'pnpm ts', workdir: '/repo' });
    expect(d.kind).toBe('exec');
    expect(d.detail).toBe('pnpm ts');
  });

  it('unwraps a shell array, preferring the -lc payload', () => {
    const d = describeToolCall('shell', { command: ['bash', '-lc', 'rg foo src/'] });
    expect(d.detail).toBe('rg foo src/');
  });

  it('extracts the touched file from an apply_patch body', () => {
    const patch = '*** Begin Patch\n*** Update File: src/screens/TickerRow.tsx\n+ x\n*** End Patch';
    const d = describeToolCall('apply_patch', patch);
    expect(d).toMatchObject({ glyph: 'edit', kind: 'edit', target: 'TickerRow.tsx' });
  });

  it('surfaces the in-progress step of update_plan', () => {
    const d = describeToolCall('update_plan', {
      plan: [
        { step: 'Map files', status: 'completed' },
        { step: 'Review providers', status: 'in_progress' },
      ],
    });
    expect(d).toMatchObject({ glyph: 'plan', kind: 'plan', target: 'Review providers' });
  });

  it('classifies PTY plumbing as low-signal', () => {
    expect(describeToolCall('write_stdin', { chars: '' }).kind).toBe('plumbing');
    expect(isPlumbingTool('write_stdin')).toBe(true);
    expect(isPlumbingTool('read_thread_terminal')).toBe(true);
    expect(isPlumbingTool('Bash')).toBe(false);
  });
});

describe('describeToolResult', () => {
  it('counts Read lines', () => {
    expect(describeToolResult('Read', '   1→a\n   2→b\n   3→c')).toBe('3 lines');
    expect(describeToolResult('Read', '   1→only one line')).toBe('1 line');
  });

  it('counts Glob files and Grep matches', () => {
    expect(describeToolResult('Glob', 'public/llms.txt\npublic/llms-full.txt')).toBe('2 files');
    expect(describeToolResult('Grep', 'a.ts:1: x\nb.ts:2: y\nc.ts:3: z')).toBe('3 matches');
  });

  it('shows exit code only for failed commands', () => {
    expect(describeToolResult('command_execution', 'ok', 0)).toBeNull();
    expect(describeToolResult('command_execution', 'boom', 1)).toBe('exit 1');
  });

  it('parses the Codex on-disk exec exit header when no exitCode is passed', () => {
    const body = 'Chunk ID: x\nWall time: 0.5 seconds\nProcess exited with code 2\nOutput:\nnope';
    expect(describeToolResult('exec_command', body)).toBe('exit 2');
  });

  it('returns null for tools with no useful summary', () => {
    expect(describeToolResult('Edit', 'The file has been updated.')).toBeNull();
  });
});
