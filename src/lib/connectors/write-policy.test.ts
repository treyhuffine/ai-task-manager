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

// Real action inventory (provider.method, mutating, risk) from @connectors/engine providers.
const AUTO_BY_DEFAULT = [
  ['gmail.create_draft', 'medium'],
  ['gmail.modify_labels', 'medium'],
  ['google_calendar.create_event', 'medium'],
  ['google_calendar.update_event', 'medium'],
  ['google_docs.append_text', 'medium'],
  ['google_sheets.append_values', 'medium'],
  ['notion.create_page', 'medium'],
  ['notion.append_blocks', 'medium'],
  ['jira.create_issue', 'medium'],
  ['jira.add_comment', 'low'],
  ['asana.create_task', 'low'],
  ['todoist.complete_task', 'low'],
  ['airtable.create_record', 'medium'],
] as const;

const ASK_OUTWARD = [
  ['slack.post_message', 'medium'],
  ['discord.post_message', 'medium'],
  ['telegram.send_message', 'low'],
  ['telegram.send_photo', 'low'],
  ['whatsapp.send_message', 'low'],
  ['whatsapp.send_template', 'low'],
  ['resend.send_email', 'medium'],
  ['mailgun.send_message', 'medium'],
  ['twitter.upload_media', 'medium'],
] as const;

const ASK_HIGH = [
  ['gmail.send_email', 'high'],
  ['outlook_mail.send_mail', 'high'],
  ['google_drive.delete_file', 'high'],
  ['google_calendar.delete_event', 'high'],
  ['airtable.delete_record', 'high'],
  ['stripe.create_customer', 'high'],
  ['calendly.cancel_event', 'high'],
  ['zoom.delete_meeting', 'high'],
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
  const prev = process.env.FLOW_CONFIG_DIR;
  function freshConfigDir(): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-policy-'));
    dirs.push(dir);
    process.env.FLOW_CONFIG_DIR = dir;
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    if (prev === undefined) delete process.env.FLOW_CONFIG_DIR;
    else process.env.FLOW_CONFIG_DIR = prev;
  });

  it('an override flips an action either way and persists', () => {
    freshConfigDir();
    // gate a normally-auto action
    setActionOverride('gmail.create_draft', 'ask');
    expect(getActionOverride('gmail.create_draft')).toBe('ask');
    expect(resolveApprovalMode({ actionId: 'gmail.create_draft', risk: 'medium', mutating: true })).toBe('ask');
    // trust a normally-gated outward action
    setActionOverride('slack.post_message', 'auto');
    expect(resolveApprovalMode({ actionId: 'slack.post_message', risk: 'medium', mutating: true })).toBe('auto');
    expect(fs.existsSync(path.join(process.env.FLOW_CONFIG_DIR!, 'connectors', 'write-policy.json'))).toBe(true);
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
});
