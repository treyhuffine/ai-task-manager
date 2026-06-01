import { describe, it, expect } from 'vitest';
import { previewName, isValidPreviewLabel, MAX_LABEL_LENGTH } from './preview-name';

describe('previewName', () => {
  it('returns the worktree name unchanged when already a valid label', () => {
    expect(previewName('flow-a3f9')).toBe('flow-a3f9');
  });

  it('appends a service suffix with a hyphen', () => {
    expect(previewName('flow-a3f9', 'api')).toBe('flow-a3f9-api');
    expect(previewName('flow-a3f9', 'web')).toBe('flow-a3f9-web');
  });

  it('lowercases and replaces invalid characters with hyphens', () => {
    expect(previewName('Flow_A3F9')).toBe('flow-a3f9');
    expect(previewName('my app!')).toBe('my-app');
    expect(previewName('feature/login.page')).toBe('feature-login-page');
  });

  it('collapses hyphen runs and trims edges', () => {
    expect(previewName('--flow__a3f9--')).toBe('flow-a3f9');
    expect(previewName('a   b')).toBe('a-b');
  });

  it('sanitizes the service part too', () => {
    expect(previewName('flow-a3f9', 'API Server')).toBe('flow-a3f9-api-server');
    expect(previewName('flow-a3f9', '/web/')).toBe('flow-a3f9-web');
  });

  it('falls back to "app" for empty / fully-stripped input', () => {
    expect(previewName('')).toBe('app');
    expect(previewName('---')).toBe('app');
    expect(previewName('!!!')).toBe('app');
  });

  it('produces a valid label even when only the service survives', () => {
    expect(previewName('!!!', 'api')).toBe('app-api');
  });

  it('clamps to 63 chars without leaving a trailing hyphen', () => {
    const long = 'a'.repeat(70);
    const out = previewName(long);
    expect(out.length).toBe(MAX_LABEL_LENGTH);
    expect(out.endsWith('-')).toBe(false);

    // A name whose 63rd char would be a hyphen gets re-trimmed.
    const tricky = `${'b'.repeat(62)}-cccc`;
    const trimmed = previewName(tricky);
    expect(trimmed.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
    expect(trimmed.endsWith('-')).toBe(false);
  });

  it('always yields an RFC-1123 label for arbitrary input', () => {
    const inputs = ['flow-a3f9', 'WEIRD input/here', '...', 'a'.repeat(200), 'ünïcödé'];
    for (const input of inputs) {
      expect(isValidPreviewLabel(previewName(input))).toBe(true);
      expect(isValidPreviewLabel(previewName(input, 'svc'))).toBe(true);
    }
  });
});

describe('isValidPreviewLabel', () => {
  it('accepts valid labels', () => {
    expect(isValidPreviewLabel('flow-a3f9')).toBe(true);
    expect(isValidPreviewLabel('a')).toBe(true);
    expect(isValidPreviewLabel('a1b2c3')).toBe(true);
  });

  it('rejects empty, too-long, edge-hyphen, and invalid-char labels', () => {
    expect(isValidPreviewLabel('')).toBe(false);
    expect(isValidPreviewLabel('a'.repeat(64))).toBe(false);
    expect(isValidPreviewLabel('-abc')).toBe(false);
    expect(isValidPreviewLabel('abc-')).toBe(false);
    expect(isValidPreviewLabel('a.b')).toBe(false);
    expect(isValidPreviewLabel('Abc')).toBe(false);
  });
});
