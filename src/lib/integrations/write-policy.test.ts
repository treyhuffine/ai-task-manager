import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  defaultApprovalMode,
  isOutwardAction,
  resolveApprovalMode,
  setActionOverride,
  getActionOverride,
  listOverrides,
} from './write-policy';

// Current native actions and documented hosted tool names, with explicit policy
// inputs. Runtime discovery determines the actual tool annotations and risk.
const AUTO_BY_DEFAULT = [
  ['gmail.create_draft', 'medium'],
  ['gmail.modify_labels', 'medium'],
  ['google_calendar.create_event', 'medium'],
  ['google_calendar.update_event', 'medium'],
  ['google_docs.append_text', 'medium'],
  ['google_sheets.append_values', 'medium'],
  ['asana.create_tasks', 'medium'],
  ['todoist.add-tasks', 'medium'],
] as const;

const ASK_OUTWARD = [
  ['discord.post_message', 'medium'],
  ['telegram.send_message', 'low'],
  ['telegram.send_photo', 'low'],
  ['whatsapp.send_message', 'low'],
  ['whatsapp.send_template', 'low'],
  ['mailgun.send_message', 'medium'],
  ['mcp.mail.send-email', 'medium'],
  ['mcp.chat.post-message', 'medium'],
  ['mcp.files.upload-file', 'medium'],
] as const;

const ASK_HIGH = [
  ['gmail.send_email', 'high'],
  ['outlook_mail.send_mail', 'high'],
  ['google_drive.delete_file', 'high'],
  ['google_calendar.delete_event', 'high'],
  ['atlassian.createJiraIssue', 'high'],
  ['atlassian.addCommentToJiraIssue', 'high'],
  ['stripe.stripe_api_write', 'high'],
  // Slack's documented upload tool uses its hosted provider's high write floor.
  ['slack.slack_complete_file_upload', 'high'],
  ['todoist.update-tasks', 'high'],
  ['todoist.complete-tasks', 'high'],
] as const;

describe('defaultApprovalMode', () => {
  it('auto-approves reversible internal writes', () => {
    for (const [id, risk] of AUTO_BY_DEFAULT) {
      expect(defaultApprovalMode({ actionId: id, risk, mutating: true }), id).toBe('auto');
    }
  });

  it('gates outward sends even when risk is low/medium', () => {
    for (const [id, risk] of ASK_OUTWARD) {
      expect(defaultApprovalMode({ actionId: id, risk, mutating: true }), id).toBe('ask');
    }
  });

  it('gates every high-risk (irreversible / money) action', () => {
    for (const [id, risk] of ASK_HIGH) {
      expect(defaultApprovalMode({ actionId: id, risk, mutating: true }), id).toBe('ask');
    }
  });

  it('never gates a non-mutating read', () => {
    expect(defaultApprovalMode({ actionId: 'gmail.search_messages', risk: 'low', mutating: false })).toBe('auto');
    // even a hypothetical read whose name looks outward
    expect(defaultApprovalMode({ actionId: 'x.get_messages', risk: 'high', mutating: false })).toBe('auto');
  });
});

describe('isOutwardAction', () => {
  it('flags sends/posts/uploads and message/mail nouns', () => {
    for (const [id] of ASK_OUTWARD) expect(isOutwardAction(id), id).toBe(true);
    expect(isOutwardAction('gmail.send_email')).toBe(true);
  });
  it('does not flag reversible internal writes', () => {
    for (const [id] of AUTO_BY_DEFAULT) expect(isOutwardAction(id), id).toBe(false);
  });
});

describe('overrides', () => {
  const dirs: string[] = [];
  const prev = process.env.RI_CONFIG_DIR;
  function freshConfigDir(): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-policy-'));
    dirs.push(dir);
    process.env.RI_CONFIG_DIR = dir;
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    if (prev === undefined) delete process.env.RI_CONFIG_DIR;
    else process.env.RI_CONFIG_DIR = prev;
  });

  it('an override flips an action either way and persists', () => {
    freshConfigDir();
    // gate a normally-auto action
    setActionOverride('gmail.create_draft', 'ask');
    expect(getActionOverride('gmail.create_draft')).toBe('ask');
    expect(resolveApprovalMode({ actionId: 'gmail.create_draft', risk: 'medium', mutating: true })).toBe('ask');
    // trust a normally-gated outward action
    setActionOverride('slack.slack_complete_file_upload', 'auto');
    expect(resolveApprovalMode({ actionId: 'slack.slack_complete_file_upload', risk: 'high', mutating: true })).toBe('auto');
    expect(fs.existsSync(path.join(process.env.RI_CONFIG_DIR!, 'integrations', 'write-policy.json'))).toBe(true);
  });

  it('clearing an override restores the default', () => {
    freshConfigDir();
    setActionOverride('gmail.send_email', 'auto');
    expect(resolveApprovalMode({ actionId: 'gmail.send_email', risk: 'high', mutating: true })).toBe('auto');
    setActionOverride('gmail.send_email', null);
    expect(getActionOverride('gmail.send_email')).toBeUndefined();
    expect(resolveApprovalMode({ actionId: 'gmail.send_email', risk: 'high', mutating: true })).toBe('ask');
    expect(listOverrides()).toEqual({});
  });

  it('keeps each canonical action preference independent and clears it without a replacement mapping', () => {
    freshConfigDir();
    setActionOverride('todoist.add-tasks', 'ask');
    expect(getActionOverride('todoist.update-tasks')).toBeUndefined();
    expect(listOverrides()).toEqual({ 'todoist.add-tasks': 'ask' });
    setActionOverride('todoist.add-tasks', null);
    expect(getActionOverride('todoist.add-tasks')).toBeUndefined();
    expect(listOverrides()).toEqual({});
    expect(resolveApprovalMode({ actionId: 'todoist.add-tasks', risk: 'medium', mutating: true })).toBe('auto');
  });
});
