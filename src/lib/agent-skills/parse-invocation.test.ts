/**
 * What counts as invoking a skill. This runs on every send, and a false
 * positive writes a usage row for a command that does not exist — inert, but
 * the path separator case is worth pinning because pasted absolute paths are
 * common in a coding composer.
 */
import { describe, it, expect } from 'vitest';
import { parseSlashInvocation } from './parse-invocation';

describe('parseSlashInvocation', () => {
  it('reads a bare command', () => {
    expect(parseSlashInvocation('/ship')).toBe('ship');
  });

  it('reads a command with arguments', () => {
    expect(parseSlashInvocation('/implementing-specs docs/spec.md')).toBe('implementing-specs');
  });

  it('accepts the punctuation skill names use', () => {
    expect(parseSlashInvocation('/geo-audit')).toBe('geo-audit');
    expect(parseSlashInvocation('/plugin:skill')).toBe('plugin:skill');
    expect(parseSlashInvocation('/apps.web')).toBe('apps.web');
    expect(parseSlashInvocation('/spec_workflow')).toBe('spec_workflow');
  });

  it('lowercases so `/Ship` and `/ship` are one command', () => {
    expect(parseSlashInvocation('/Ship')).toBe('ship');
  });

  it('tolerates leading whitespace and a trailing newline', () => {
    expect(parseSlashInvocation('  /qa\n')).toBe('qa');
    expect(parseSlashInvocation('/qa\nsecond line')).toBe('qa');
  });

  it('ignores an absolute path, which is not an invocation', () => {
    expect(parseSlashInvocation('/Users/me/notes.md is the file')).toBeNull();
    expect(parseSlashInvocation('/tmp/x')).toBeNull();
  });

  it('ignores a slash that is not at the start', () => {
    // Matches the composer trigger, which only opens the menu at start-of-line.
    expect(parseSlashInvocation('please run /ship for me')).toBeNull();
  });

  it('ignores a bare slash and a leading separator', () => {
    expect(parseSlashInvocation('/')).toBeNull();
    expect(parseSlashInvocation('/ ship')).toBeNull();
    expect(parseSlashInvocation('/-ship')).toBeNull();
  });

  it('ignores ordinary prose', () => {
    expect(parseSlashInvocation('fix the login bug')).toBeNull();
    expect(parseSlashInvocation('')).toBeNull();
  });
});
