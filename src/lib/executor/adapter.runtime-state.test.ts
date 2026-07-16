import { beforeEach, describe, expect, it } from 'vitest';
import {
  _beginActiveDispatch,
  _endActiveDispatch,
  _resetExecutorState,
  beginDispatchPreparation,
  endDispatchPreparation,
  forceClearInflight,
  listRunningSessions,
} from './adapter';

describe('executor dispatch preparation runtime state', () => {
  beforeEach(() => {
    _resetExecutorState();
  });

  it('keeps the session running until every preparation reference settles', () => {
    const first = beginDispatchPreparation('chat-1');
    const second = beginDispatchPreparation('chat-1');
    expect(listRunningSessions()).toEqual(['chat-1']);

    endDispatchPreparation('chat-1', first);
    expect(listRunningSessions()).toEqual(['chat-1']);

    endDispatchPreparation('chat-1', second);
    expect(listRunningSessions()).toEqual([]);
  });

  it('allows a first non-concurrent dispatch with its own preparation hold', () => {
    const preparation = beginDispatchPreparation('chat-1');

    const active = _beginActiveDispatch('chat-1', false);
    expect(listRunningSessions()).toEqual(['chat-1']);

    _endActiveDispatch('chat-1', active);
    expect(listRunningSessions()).toEqual(['chat-1']);

    endDispatchPreparation('chat-1', preparation);
    expect(listRunningSessions()).toEqual([]);
  });

  it('rejects a second non-concurrent dispatch while the first provider send is active', () => {
    const firstPreparation = beginDispatchPreparation('chat-1');
    const firstActive = _beginActiveDispatch('chat-1', false);

    const secondPreparation = beginDispatchPreparation('chat-1');
    expect(() => _beginActiveDispatch('chat-1', false)).toThrow(
      expect.objectContaining({ code: 'already_running' }),
    );

    endDispatchPreparation('chat-1', secondPreparation);
    _endActiveDispatch('chat-1', firstActive);
    expect(listRunningSessions()).toEqual(['chat-1']);

    endDispatchPreparation('chat-1', firstPreparation);
    expect(listRunningSessions()).toEqual([]);
  });

  it('clears preparation and active-dispatch state on forced recovery and reset', () => {
    beginDispatchPreparation('chat-1');
    _beginActiveDispatch('chat-1', false);
    forceClearInflight('chat-1');
    expect(listRunningSessions()).toEqual([]);
    expect(() => _beginActiveDispatch('chat-1', false)).not.toThrow();

    _resetExecutorState();
    expect(listRunningSessions()).toEqual([]);
    const active = _beginActiveDispatch('chat-1', false);
    _endActiveDispatch('chat-1', active);
    expect(listRunningSessions()).toEqual([]);
  });

  it('ignores stale finalizers after forced recovery starts replacement work', () => {
    const stalePreparation = beginDispatchPreparation('chat-1');
    const staleActive = _beginActiveDispatch('chat-1', false);

    forceClearInflight('chat-1');

    const replacementPreparation = beginDispatchPreparation('chat-1');
    const replacementActive = _beginActiveDispatch('chat-1', false);

    _endActiveDispatch('chat-1', staleActive);
    endDispatchPreparation('chat-1', stalePreparation);

    expect(listRunningSessions()).toEqual(['chat-1']);
    expect(() => _beginActiveDispatch('chat-1', false)).toThrow(
      expect.objectContaining({ code: 'already_running' }),
    );

    _endActiveDispatch('chat-1', replacementActive);
    endDispatchPreparation('chat-1', replacementPreparation);
    expect(listRunningSessions()).toEqual([]);
  });
});
