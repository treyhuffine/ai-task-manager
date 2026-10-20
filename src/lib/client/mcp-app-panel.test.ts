import { describe, expect, it } from 'vitest';
import { mayPlaceResult, type CompanionState } from './mcp-app-panel';

const empty: CompanionState = {captureId: null, tab: null, opening: false, placedId: null};
const tab = {serverId: 'bnb', name: 'tray', title: 'Parts tray'};

describe('a fresh result placing itself beside a chat', () => {
  it('opens into an empty pane', () => {
    expect(mayPlaceResult(empty)).toBe(true);
  });

  it('never replaces a tab the person opened, or one still opening', () => {
    expect(mayPlaceResult({...empty, captureId: 'tab-capture', tab})).toBe(false);
    expect(mayPlaceResult({...empty, opening: true})).toBe(false);
    // Even a tab opened over a placed result.
    expect(mayPlaceResult({...empty, captureId: 'tab-capture', tab, placedId: 'tab-capture'})).toBe(false);
  });

  it('never replaces a result the person moved beside the chat', () => {
    expect(mayPlaceResult({...empty, captureId: 'chosen'})).toBe(false);
  });

  it('replaces a result that placed itself the same way', () => {
    expect(mayPlaceResult({...empty, captureId: 'earlier', placedId: 'earlier'})).toBe(true);
  });

  it('replaces nothing where the browser cannot move a live view, since the replaced one would reload', () => {
    expect(mayPlaceResult({...empty, captureId: 'earlier', placedId: 'earlier', canMove: false})).toBe(false);
    expect(mayPlaceResult({...empty, canMove: false})).toBe(true);
  });
});
