/**
 * Native agent browser actions. Registered into the orchestrator registry, so
 * they light up on both the CLI (`flow agent browser_...`) and the HTTP MCP.
 *
 * Small, stable surface: two verbs the agent drives (`browser_read`,
 * `browser_act`) plus operational actions. See docs/browser-capability-proposal.md.
 *
 * Profiles: a `profile` is a separate logged-in identity (its own cookie jar).
 * Every action takes an optional `profile` (default "agent"). Pass a different
 * name to use a different logged-in browser. `browser_profiles` lists them.
 */

import { z } from 'zod';
import { defineAction, ActionError } from './types';
import {
  requireBrowser,
  isBrowserEnabled,
  getHeadlessDefault,
  browserConfigSummary,
  listBrowserProfiles,
  resolveProfile,
  getDefaultProfile,
} from '@/lib/browser/config';
import {
  getSession,
  getActivePage,
  setMarks,
  forgetSession,
  listTabs,
  selectTab,
  closeTab,
  openTab,
} from '@/lib/browser/runtime';
import { isBrowserOpen, closeBrowser } from '@/lib/browser/session';
import { readPage } from '@/lib/browser/read';
import { performAct, performBatch, type ActInput } from '@/lib/browser/act';
import { assertNavigable } from '@/lib/browser/confine';
import { importCookies } from '@/lib/browser/cookie-import';
import { appendAudit, readAuditTail } from '@/lib/browser/audit';

const readMode = z.enum(['snapshot', 'text', 'screenshot', 'pdf']);
const actKind = z.enum([
  'click',
  'type',
  'press',
  'hover',
  'select',
  'scroll',
  'wait',
  'upload',
  'evaluate',
  'back',
  'forward',
  'reload',
]);
const waitFor = z.enum(['load', 'domcontentloaded', 'networkidle']);
const profileParam = z.string().optional();

/** The fields shared by a single act and a batch step (minus the kind). */
const actStepFields = {
  ref: z.string().optional(),
  text: z.string().optional(),
  submit: z.boolean().optional(),
  key: z.string().optional(),
  values: z.array(z.string()).optional(),
  attachment: z.string().optional(),
  ms: z.number().int().nonnegative().optional(),
  selector: z.string().optional(),
  wait_for: waitFor.optional(),
  fn: z.string().optional(),
  accept_dialog: z.boolean().optional(),
  dialog_text: z.string().optional(),
};
const actStepSchema = z.object({ kind: actKind, ...actStepFields });

/** Map the wire (snake_case) act shape to the internal ActInput. */
function toActInput(s: z.infer<typeof actStepSchema>): ActInput {
  return {
    kind: s.kind,
    ref: s.ref,
    text: s.text,
    submit: s.submit,
    key: s.key,
    values: s.values,
    attachmentFile: s.attachment,
    ms: s.ms,
    selector: s.selector,
    waitFor: s.wait_for,
    fn: s.fn,
    acceptDialog: s.accept_dialog,
    dialogText: s.dialog_text,
  };
}

async function goto(url: string, profile: string, headless: boolean) {
  assertNavigable(url);
  const session = await getSession({ profile, headless });
  const page = await getActivePage(session);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch (err) {
    throw new ActionError(
      'unsupported',
      `Navigation to ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return session;
}

export const browser_read_action = defineAction({
  name: 'browser_read',
  description:
    'Read a web page through the agent browser. Navigates when a url is given, then returns the page. mode "snapshot" (default) is the accessibility tree with [ref=..] ids to act on, "text" is the readable article body, "screenshot" is a set-of-marks image for canvas or shadow-DOM pages, "pdf" files the page as a Flow attachment. Reads are ungated within the login scope you curate. If a login or challenge wall is detected, the result carries a "blocked" field: hand back to the user, do not try to log in. profile selects which logged-in identity to use (default "agent").',
  params: {
    url: z.string().url().optional(),
    profile: profileParam,
    mode: readMode.optional(),
    selector: z.string().optional(),
    max_chars: z.number().int().positive().optional(),
    efficient: z.boolean().optional(),
    full_page: z.boolean().optional(),
  },
  cli: { positional: ['url'] },
  handler: async (_ctx, input) => {
    requireBrowser();
    const profile = resolveProfile(input.profile);
    const headless = getHeadlessDefault();
    const session = input.url
      ? await goto(input.url, profile, headless)
      : await getSession({ profile, headless });

    const result = await readPage(await getActivePage(session), {
      mode: input.mode,
      selector: input.selector,
      maxChars: input.max_chars,
      efficient: input.efficient,
      fullPage: input.full_page,
      session: profile,
    });
    if (result.marks) setMarks(session, result.marks);

    appendAudit({
      action: 'browser_read',
      session: profile,
      url: result.url,
      detail: `mode=${result.mode} refs=${result.refCount ?? ''}`,
      blocked: result.blocked?.kind,
    });
    return result;
  },
});

export const browser_act_action = defineAction({
  name: 'browser_act',
  description:
    'Perform one interaction on the current tab: click, type, press, hover, select, scroll, wait, upload, evaluate, back, forward, or reload. Target with ref (an aria-ref id like e12 from a snapshot read) or a mark id (m3 from a screenshot read). wait can take a selector or a wait_for load state, not only ms. evaluate runs a JS expression (fn) and is restricted to trusted local callers. Pass an idempotency_key so a retry never repeats a side effect. Set accept_dialog=true (with dialog_text for a prompt) to accept a JS dialog the action triggers, otherwise dialogs are dismissed. The result includes the new page state, downloads (as Flow attachments), a dialog it triggered, a blocked signal, and newTab if it opened one (the active tab switches to it).',
  mutating: true,
  params: {
    profile: profileParam,
    kind: actKind,
    ...actStepFields,
    idempotency_key: z.string().optional(),
  },
  handler: async (ctx, input) => {
    requireBrowser();
    if (input.kind === 'evaluate' && (ctx.remote ?? true)) {
      throw new ActionError('unsupported', 'The evaluate action is restricted to trusted local callers.');
    }
    const profile = resolveProfile(input.profile);
    const session = await getSession({ profile, headless: getHeadlessDefault() });

    if (input.idempotency_key && session.appliedKeys.has(input.idempotency_key)) {
      return session.appliedKeys.get(input.idempotency_key);
    }

    const result = await performAct(session, toActInput(input));

    if (input.idempotency_key) session.appliedKeys.set(input.idempotency_key, result);
    appendAudit({
      action: 'browser_act',
      session: profile,
      url: result.pageState.url,
      kind: input.kind,
      ref: input.ref,
      detail: `navigated=${result.navigated} downloads=${result.downloads.length}`,
    });
    return result;
  },
});

export const browser_batch_action = defineAction({
  name: 'browser_batch',
  description:
    'Run several acts in one call, one round-trip. Each step has the same fields as browser_act (kind, ref, text, ...). Good for a known sequence like filling a form: type, type, click. Stops if a step errors or navigates (refs are for the pre-navigation page) and reports which step and why. Returns the final page state once.',
  mutating: true,
  params: {
    profile: profileParam,
    steps: z.array(actStepSchema).min(1),
    idempotency_key: z.string().optional(),
  },
  handler: async (ctx, input) => {
    requireBrowser();
    if ((ctx.remote ?? true) && input.steps.some((s) => s.kind === 'evaluate')) {
      throw new ActionError('unsupported', 'The evaluate action is restricted to trusted local callers.');
    }
    const profile = resolveProfile(input.profile);
    const session = await getSession({ profile, headless: getHeadlessDefault() });

    if (input.idempotency_key && session.appliedKeys.has(input.idempotency_key)) {
      return session.appliedKeys.get(input.idempotency_key);
    }

    const result = await performBatch(session, input.steps.map(toActInput));
    if (input.idempotency_key) session.appliedKeys.set(input.idempotency_key, result);
    appendAudit({
      action: 'browser_batch',
      session: profile,
      url: result.pageState.url,
      detail: `steps=${input.steps.length} aborted=${result.aborted?.reason ?? 'no'}`,
    });
    return result;
  },
});

export const browser_tabs_action = defineAction({
  name: 'browser_tabs',
  description:
    'List, switch, open, or close browser tabs. action=list (default) returns every tab with its index, url, title, and which is active. action=select needs index (makes that tab active). action=close needs index. action=new opens a tab (optionally at url) and makes it active. Reads and acts operate on the active tab.',
  mutating: true,
  params: {
    profile: profileParam,
    action: z.enum(['list', 'select', 'close', 'new']).optional(),
    index: z.number().int().nonnegative().optional(),
    url: z.string().url().optional(),
  },
  handler: async (_ctx, input) => {
    requireBrowser();
    const profile = resolveProfile(input.profile);
    const session = await getSession({ profile, headless: getHeadlessDefault() });
    const action = input.action ?? 'list';

    if (action === 'select') {
      if (input.index === undefined) throw new ActionError('invalid_params', 'select needs an index.');
      selectTab(session, input.index);
    } else if (action === 'close') {
      if (input.index === undefined) throw new ActionError('invalid_params', 'close needs an index.');
      await closeTab(session, input.index);
    } else if (action === 'new') {
      const page = await openTab(session);
      if (input.url) {
        assertNavigable(input.url);
        await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((err) => {
          throw new ActionError('unsupported', `Navigation failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }

    const tabs = await listTabs(session);
    appendAudit({ action: 'browser_tabs', session: profile, detail: `${action} tabs=${tabs.length}` });
    return { action, tabs };
  },
});

export const browser_open_action = defineAction({
  name: 'browser_open',
  description:
    'Open the agent browser in a headed window so a human can sign in. This is how a profile gets created and logged in: it opens the dedicated profile, the human signs in by hand, and the session persists. Use it when a read is blocked by a login the profile does not have. Not for automated login. profile selects which identity to open (default "agent").',
  mutating: true,
  params: {
    url: z.string().url().optional(),
    profile: profileParam,
    headless: z.boolean().optional(),
  },
  cli: { positional: ['url'] },
  handler: async (_ctx, input) => {
    requireBrowser();
    const profile = resolveProfile(input.profile);
    const headless = input.headless ?? false; // headed by default: the point is a human logging in
    const session = input.url
      ? await goto(input.url, profile, headless)
      : await getSession({ profile, headless });
    const url = (await getActivePage(session)).url();
    appendAudit({ action: 'browser_open', session: profile, url });
    return { ok: true, opened: true, profile, headless, url };
  },
});

export const browser_profiles_action = defineAction({
  name: 'browser_profiles',
  description:
    'List the agent browser profiles. Each profile is a separate logged-in identity with its own cookie jar. The default is "agent". Pass profile=<name> to any browser action to use a different one, and open a new one with browser_open profile=<name> to log into it.',
  params: {},
  handler: () => {
    return { default: getDefaultProfile(), profiles: listBrowserProfiles() };
  },
});

export const browser_import_cookies_action = defineAction({
  name: 'browser_import_cookies',
  description:
    'macOS only, trusted local callers only. Copy a domain\'s cookies from your everyday Chrome or Brave into an agent profile, so it is signed in without a manual login. Triggers a one-time Keychain prompt. source defaults to chrome, chrome_profile to Default, profile (the target agent profile) to "agent".',
  mutating: true,
  params: {
    domain: z.string().min(1),
    source: z.enum(['chrome', 'brave']).optional(),
    chrome_profile: z.string().optional(),
    profile: profileParam,
  },
  handler: async (ctx, input) => {
    requireBrowser();
    if (ctx.remote ?? true) {
      throw new ActionError('unsupported', 'Cookie import is restricted to trusted local callers.');
    }
    const profile = resolveProfile(input.profile);
    const result = await importCookies({
      domain: input.domain,
      source: input.source,
      chromeProfile: input.chrome_profile,
      profile,
    });
    appendAudit({
      action: 'browser_import_cookies',
      session: profile,
      detail: `${result.source} ${result.domain} imported=${result.imported}`,
    });
    return result;
  },
});

export const browser_status_action = defineAction({
  name: 'browser_status',
  description:
    'Report the agent browser status: whether one is open, the configured browser, the profiles that exist, and the recent audit trail (which pages were read and what was done).',
  params: {
    profile: profileParam,
    audit_limit: z.number().int().positive().max(200).optional(),
  },
  handler: async (_ctx, input) => {
    const open = await isBrowserOpen(resolveProfile(input.profile));
    return {
      enabled: isBrowserEnabled(),
      open,
      config: browserConfigSummary(),
      profiles: listBrowserProfiles(),
      audit: readAuditTail(input.audit_limit ?? 20),
    };
  },
});

export const browser_close_action = defineAction({
  name: 'browser_close',
  description:
    'Close the agent browser and everything in it. The kill switch. Idempotent: closing when nothing is open is a no-op. profile selects which one to close (default "agent").',
  mutating: true,
  params: {
    profile: profileParam,
  },
  handler: async (_ctx, input) => {
    const profile = resolveProfile(input.profile);
    const result = await closeBrowser(profile);
    forgetSession(profile);
    appendAudit({ action: 'browser_close', session: profile, detail: `closed=${result.closed}` });
    return result;
  },
});

export const browserActions = [
  browser_read_action,
  browser_act_action,
  browser_batch_action,
  browser_tabs_action,
  browser_open_action,
  browser_profiles_action,
  browser_import_cookies_action,
  browser_status_action,
  browser_close_action,
];
