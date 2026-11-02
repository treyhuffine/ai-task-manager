import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import type { SkillView } from '@/lib/api/skills';
import { SkillHeader } from './skill-header';

const fixtures = vi.hoisted(() => ({
  goHome: vi.fn(),
  confirm: vi.fn<() => Promise<boolean>>(),
  flushAll: vi.fn<() => Promise<void>>(),
  archive: vi.fn<(ref: string) => Promise<unknown>>(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/components/skills/skill-navigation', () => ({
  useSkillNavigation: () => ({ goHome: fixtures.goHome, canManage: false, showSetupHelp: false }),
}));
vi.mock('@/hooks/use-skills', () => ({
  useArchiveSkill: () => ({ mutateAsync: fixtures.archive }),
  useCommitSkill: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/client/document-saves', () => ({ documentSaves: { flushAll: fixtures.flushAll } }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => fixtures.confirm }));
vi.mock('sonner', () => ({ toast: { success: fixtures.success, error: fixtures.error } }));
vi.mock('@/components/plugins/setup-help-button', () => ({ PluginSetupHelpButton: () => null }));
vi.mock('./skill-location-control', () => ({ SkillLocationControl: () => null }));
vi.mock('@/components/ui/tip', () => ({ Tip: ({ children }: { children: ReactNode }) => children }));
// The menu's items as plain buttons, so a click is the item's select.
vi.mock('@/components/ui/dropdown-menu', () => {
  const pass = ({ children }: { children?: ReactNode }) => children;
  return {
    DropdownMenu: pass, DropdownMenuTrigger: pass, DropdownMenuContent: pass, DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({ children, onSelect }: { children?: ReactNode; onSelect?: () => void }) =>
      createElement('button', { onClick: onSelect }, children),
  };
});

const skill = { ref: 'ri:release-notes', name: 'release-notes', dir: '/skills/release-notes', editable: true, location: { kind: 'ri' }, git: null, uncommitted: false } as unknown as SkillView;
let root: Root | undefined;
let container: HTMLElement;

beforeEach(async () => {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  for (const fn of Object.values(fixtures)) fn.mockReset();
  fixtures.confirm.mockResolvedValue(true);
  fixtures.flushAll.mockResolvedValue(undefined);
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root!.render(createElement(SkillHeader, { skill })));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

/** A request that resolves only when the test says so. */
function heldArchive() {
  let finish!: () => void;
  let fail!: (err: Error) => void;
  fixtures.archive.mockReturnValueOnce(new Promise((resolve, reject) => { finish = () => resolve({}); fail = reject; }));
  return { finish, fail };
}
const clickArchive = () => act(async () => {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Archive'))!;
  button.dispatchEvent(new window.Event('click', { bubbles: true }));
});

it('saves its edits, then leaves before the archive request, and toasts only when it returns', async () => {
  const request = heldArchive();
  await clickArchive();
  expect(fixtures.flushAll).toHaveBeenCalledOnce();
  expect(fixtures.archive).toHaveBeenCalledExactlyOnceWith('ri:release-notes');
  expect(fixtures.goHome).toHaveBeenCalledOnce();
  expect(fixtures.flushAll.mock.invocationCallOrder[0]).toBeLessThan(fixtures.goHome.mock.invocationCallOrder[0]!);
  expect(fixtures.goHome.mock.invocationCallOrder[0]).toBeLessThan(fixtures.archive.mock.invocationCallOrder[0]!);
  // Leaving unmounts the header. The toast still comes.
  await act(async () => root!.unmount());
  root = undefined;
  await act(async () => request.finish());
  expect(fixtures.success).toHaveBeenCalledExactlyOnceWith('release-notes archived');
  expect(fixtures.goHome).toHaveBeenCalledOnce();
});

it('a failed archive is a toast naming the skill, and nobody moves again', async () => {
  const request = heldArchive();
  await clickArchive();
  await act(async () => request.fail(new Error('Folder is busy')));
  expect(fixtures.error).toHaveBeenCalledExactlyOnceWith("Couldn't archive release-notes", { description: 'Folder is busy' });
  expect(fixtures.goHome).toHaveBeenCalledOnce();
});

it('keeps the person on edits that could not be saved, and does not archive', async () => {
  fixtures.flushAll.mockRejectedValue(new Error('Some edits could not be saved. Keep this window open and retry.'));
  await clickArchive();
  expect(fixtures.error).toHaveBeenCalledExactlyOnceWith('Some edits could not be saved. Keep this window open and retry.');
  expect(fixtures.goHome).not.toHaveBeenCalled();
  expect(fixtures.archive).not.toHaveBeenCalled();
});

it('stays put when the confirm is cancelled', async () => {
  fixtures.confirm.mockResolvedValue(false);
  await clickArchive();
  expect(fixtures.flushAll).not.toHaveBeenCalled();
  expect(fixtures.goHome).not.toHaveBeenCalled();
  expect(fixtures.archive).not.toHaveBeenCalled();
});
