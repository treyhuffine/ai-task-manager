import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { WORK_RESULT_GUIDANCE_MAX } from '@/lib/instructions/preferences';
import { WorkResultGuidanceField } from './work-result-guidance-field';

const fixtures = vi.hoisted(() => ({
  data: { workResultGuidance: 'Keep reports short.' } as { workResultGuidance: string | null } | undefined,
  loadError: false,
  refetch: vi.fn(),
  write: vi.fn<(input: { workResultGuidance: string | null }) => Promise<void>>(async () => {}),
}));

vi.mock('@/hooks/use-user-state', () => ({
  useUserState: () => ({ data: fixtures.data, isError: fixtures.loadError, refetch: fixtures.refetch }),
  useUpdateUserState: () => ({ mutateAsync: fixtures.write }),
}));

let root: Root | undefined;
let container: HTMLElement;

async function render() {
  await act(async () => root!.render(createElement(WorkResultGuidanceField)));
}

beforeEach(async () => {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixtures.data = { workResultGuidance: 'Keep reports short.' };
  fixtures.loadError = false;
  fixtures.write.mockReset().mockResolvedValue(undefined);
  fixtures.refetch.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
  await render();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

function textarea() {
  return container.querySelector<HTMLTextAreaElement>('#work-result-guidance')!;
}

function saveButton() {
  return container.querySelector<HTMLButtonElement>('button')!;
}

function mountedProps<T>(element: Element): T {
  const propsKey = Object.keys(element).find((key) => key.startsWith('__reactProps$'))!;
  return (element as unknown as Record<string, T>)[propsKey];
}

// Linkedom does not implement React's input tracking, so invoke the mounted
// callback. This still exercises the real component, effects, and save flow.
async function edit(value: string) {
  await act(async () => {
    mountedProps<{ onChange: (event: { target: { value: string } }) => void }>(textarea())
      .onChange({ target: { value } });
  });
}

async function save() {
  await act(async () => {
    await mountedProps<{ onClick: () => Promise<void> }>(saveButton()).onClick();
  });
}

describe('Shared handoff and review preferences', () => {
  it('labels the field, explains its scope and precedence, and exposes the limit', () => {
    expect(container.querySelector('label[for="work-result-guidance"]')?.textContent).toBe('Handoff and review preferences');
    expect(container.textContent).toContain('Shared preferences for how agents hand work back to you and review it.');
    expect(container.textContent).toContain('take precedence when they conflict.');
    expect(container.textContent).toContain('only to handoffs and reviews, not ordinary chat.');
    expect(textarea().getAttribute('maxLength') ?? textarea().getAttribute('maxlength'))
      .toBe(String(WORK_RESULT_GUIDANCE_MAX));
    expect(textarea().getAttribute('aria-describedby')).toContain('work-result-guidance-description');
    // Linkedom does not reflect defaultValue into value on initial textarea
    // mount. Server markup verifies the populated initial field independently.
    expect(renderToStaticMarkup(createElement(WorkResultGuidanceField)))
      .toContain('>Keep reports short.</textarea>');
    expect(saveButton().disabled).toBe(true);
  });

  it('saves only on request, trims text, and clears whitespace as null', async () => {
    await edit('  Include links to the finished work.  ');
    expect(fixtures.write).not.toHaveBeenCalled();
    await save();
    expect(fixtures.write).toHaveBeenLastCalledWith({ workResultGuidance: 'Include links to the finished work.' });
    expect(textarea().value).toBe('Include links to the finished work.');
    expect(container.textContent).toContain('Preferences saved');

    await edit(' \n  ');
    await save();
    expect(fixtures.write).toHaveBeenLastCalledWith({ workResultGuidance: null });
    expect(textarea().value).toBe('');
    expect(container.textContent).toContain('Shared preferences cleared');
  });

  it('accepts refreshed data while clean and preserves a dirty draft', async () => {
    fixtures.data = { workResultGuidance: 'Use direct language.' };
    await render();
    expect(textarea().value).toBe('Use direct language.');

    await edit('My unsaved preferences');
    fixtures.data = { workResultGuidance: 'Different preferences from a refresh' };
    await render();
    expect(textarea().value).toBe('My unsaved preferences');
    expect(container.textContent).toContain('Unsaved changes');
  });

  it('applies the latest deferred refresh when a dirty draft is reverted', async () => {
    await edit('My unsaved preferences');
    fixtures.data = { workResultGuidance: 'First external update' };
    await render();
    fixtures.data = { workResultGuidance: 'Latest external update' };
    await render();
    expect(textarea().value).toBe('My unsaved preferences');

    await edit('  Keep reports short.  ');
    expect(textarea().value).toBe('Latest external update');
    expect(saveButton().disabled).toBe(true);
    expect(container.textContent).not.toContain('Unsaved changes');
    expect(fixtures.write).not.toHaveBeenCalled();
  });

  it('preserves typing made during a save and allows saving the newer draft', async () => {
    let resolveSave!: () => void;
    fixtures.write.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    await edit('First submitted preferences');
    let saving!: Promise<void>;
    await act(async () => {
      saving = mountedProps<{ onClick: () => Promise<void> }>(saveButton()).onClick();
    });
    expect(saveButton().disabled).toBe(true);
    expect(textarea().disabled).toBe(false);

    await edit('New typing while saving');
    fixtures.data = { workResultGuidance: 'First submitted preferences' };
    await render();
    expect(textarea().value).toBe('New typing while saving');
    await act(async () => { resolveSave(); await saving; });
    expect(textarea().value).toBe('New typing while saving');
    expect(container.textContent).toContain('Unsaved changes');
    expect(saveButton().disabled).toBe(false);

    await save();
    expect(fixtures.write).toHaveBeenLastCalledWith({ workResultGuidance: 'New typing while saving' });
    expect(container.textContent).toContain('Preferences saved');
  });

  it('keeps a failed save ready for retry and does not clear the draft', async () => {
    fixtures.write.mockRejectedValueOnce(new Error('Offline'));
    await edit('Keep this unsaved draft');
    await save();
    expect(textarea().value).toBe('Keep this unsaved draft');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Your changes are still here.');
    expect(saveButton().disabled).toBe(false);
    await save();
    expect(fixtures.write).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('does not submit an oversized draft even when an input callback bypasses maxlength', async () => {
    await edit('x'.repeat(WORK_RESULT_GUIDANCE_MAX + 1));
    expect(textarea().getAttribute('aria-invalid')).toBe('true');
    expect(saveButton().disabled).toBe(true);
    await save();
    expect(fixtures.write).not.toHaveBeenCalled();
  });
});
