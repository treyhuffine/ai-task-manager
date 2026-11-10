import { expect, it } from 'vitest';
import { describeMcpBody } from './request-log';

it('names what each message asks for, and nothing it carries', () => {
  expect(describeMcpBody({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'show_deck', arguments: { secret: 'my task' } } })).toEqual(['tools/call show_deck']);
  expect(describeMcpBody([
    { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'ui://ri/view-abc.html' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
  ])).toEqual(['resources/read ui://ri/view-abc.html', 'notifications/initialized']);
  expect(describeMcpBody({ jsonrpc: '2.0', id: 3, result: {} })).toEqual([]);
  expect(describeMcpBody(null)).toEqual([]);
});
