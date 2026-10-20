import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { HOST_ORIGINS_KEY, setHostnameClaim, useClientLocation, type ClientLocation } from './use-client-location';

let root: Root;
let seen: ClientLocation[];
let stored: Map<string, string>;
let win: Window & typeof globalThis;

function Probe() {
  const location = useClientLocation();
  useLayoutEffect(() => { seen.push(location); });
  return createElement('p', null, `${location.kind}:${location.reason}`);
}

function mount(hostname: string) {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  win = window as unknown as Window & typeof globalThis;
  stored = new Map();
  Object.defineProperty(win, 'location', { configurable: true, value: { hostname } });
  Object.assign(win, {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', document);
  // The hook's own change event is built with the global Event.
  vi.stubGlobal('Event', win.Event);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root') as unknown as HTMLElement);
  act(() => root.render(createElement(Probe)));
}

const latest = () => seen[seen.length - 1];

beforeEach(() => {
  seen = [];
});

afterEach(() => {
  act(() => root?.unmount());
  vi.unstubAllGlobals();
});

describe('useClientLocation', () => {
  it('reads a loopback hostname as the host', () => {
    mount('localhost');
    expect(latest()).toEqual({ kind: 'host', reason: 'localhost', hostname: 'localhost' });
  });

  it('reads any other hostname as remote until it is claimed', () => {
    mount('ri.example.ts.net');
    expect(latest()).toEqual({ kind: 'remote', reason: 'default-remote', hostname: 'ri.example.ts.net' });

    act(() => setHostnameClaim('ri.example.ts.net', true));
    expect(latest()).toEqual({ kind: 'host', reason: 'override', hostname: 'ri.example.ts.net' });

    act(() => setHostnameClaim('ri.example.ts.net', false));
    expect(latest().kind).toBe('remote');
  });

  it('follows a claim made in another tab', () => {
    mount('192.168.1.20');
    stored.set(HOST_ORIGINS_KEY, JSON.stringify(['192.168.1.20']));
    act(() => { win.dispatchEvent(Object.assign(new win.Event('storage'), { key: HOST_ORIGINS_KEY })); });
    expect(latest().reason).toBe('override');
  });

  it('re-renders only when the answer can change', () => {
    mount('localhost');
    const renders = seen.length;
    act(() => { win.dispatchEvent(new win.Event('ri:host-origins-changed')); });
    expect(seen.length).toBe(renders);
    act(() => setHostnameClaim('ri.example.ts.net', true));
    expect(seen.length).toBe(renders + 1);
  });

  it('ignores a malformed claims list', () => {
    mount('ri.example.ts.net');
    stored.set(HOST_ORIGINS_KEY, '{not json');
    act(() => { win.dispatchEvent(new win.Event('ri:host-origins-changed')); });
    expect(latest().reason).toBe('default-remote');
  });

  it('renders as remote on the server, where there is no browser to ask', () => {
    vi.stubGlobal('window', undefined);
    expect(renderToString(createElement(Probe))).toContain('remote:default-remote');
  });
});
