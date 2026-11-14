import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as q from '@/lib/db/queries';
import { callRiService, RI_SERVICE_NAMES, RI_SERVICE_REACH, RI_SERVICE_WRITES, RiServiceError } from './ri-services';

const signal = new AbortController().signal;

it('returns the same record for a retried call and separates apps and calls', async () => {
  const appId = randomUUID(), invocationId = randomUUID();
  const input = { title: 'Synthetic app task', body: 'A task from the disposable fixture' };
  const first = await callRiService('create_task', input, { appId, invocationId }, signal) as { id: string };
  const retried = await callRiService('create_task', input, { appId, invocationId }, signal) as { id: string };
  expect(retried.id).toBe(first.id);
  expect(q.getTask(first.id)?.body).toBe(input.body);
  const otherApp = await callRiService('create_task', input, { appId: randomUUID(), invocationId }, signal) as { id: string };
  expect(otherApp.id).not.toBe(first.id);
  const otherCall = await callRiService('create_task', input, { appId, invocationId: randomUUID() }, signal) as { id: string };
  expect(otherCall.id).not.toBe(first.id);
  // Without an invocation or operation ID, every call is its own record.
  const a = await callRiService('create_task', input, { appId }, signal) as { id: string };
  const b = await callRiService('create_task', input, { appId }, signal) as { id: string };
  expect(a.id).not.toBe(b.id);
  expect(q.createTask({ title: 'Ordinary task' }).id).not.toBe(first.id);

  const note = { title: 'Fixture note', body: 'Fixture note body', operationId: randomUUID() };
  const n = await callRiService('create_note', note, { appId }, signal) as { id: string };
  expect(await callRiService('create_note', note, { appId }, signal)).toMatchObject({ id: n.id });
  expect(await callRiService('get_note', { id: n.id }, { appId }, signal)).toMatchObject({ body: 'Fixture note body' });
  await expect(callRiService('list_tasks', { limit: 101 }, { appId }, signal)).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(callRiService('get_task', { id: randomUUID() }, { appId }, signal)).rejects.toMatchObject({ code: 'not_found' });
  const aborted = new AbortController(); aborted.abort();
  await expect(callRiService('create_task', input, { appId }, aborted.signal)).rejects.toMatchObject({ code: 'interrupted' });
});

it('creates one dated Ri task per app operation and validates the due date', async () => {
  const appId = randomUUID(), operationId = randomUUID();
  const first = await callRiService('create_task', { title: 'Confirm airport transfer', dueAt: '2026-11-08', operationId }, { appId, invocationId: randomUUID() }, signal) as { id: string; hardDeadline: string | null };
  expect(first.hardDeadline).toBe('2026-11-08');
  // A second click or a retry under a new invocation still returns the first task.
  const again = await callRiService('create_task', { title: 'Confirm airport transfer', dueAt: '2026-11-08', operationId }, { appId, invocationId: randomUUID() }, signal) as { id: string };
  expect(again.id).toBe(first.id);
  const timed = await callRiService('create_task', { title: 'Prepare questions', dueAt: '2026-10-16T09:00:00-06:00', operationId: randomUUID() }, { appId }, signal) as { hardDeadline: string };
  expect(timed.hardDeadline).toBe('2026-10-16T09:00:00-06:00');
  await expect(callRiService('create_task', { title: 'Bad date', dueAt: '2026-02-30' }, { appId }, signal)).rejects.toBeInstanceOf(RiServiceError);
  await expect(callRiService('create_task', { title: 'Bad date', dueAt: 'tomorrow' }, { appId }, signal)).rejects.toThrow();
  await expect(callRiService('create_task', { title: 'Bad op', operationId: 'not-a-uuid' }, { appId }, signal)).rejects.toThrow();
});

it('extracts bounded text from chosen files and refuses unreadable ones', async () => {
  const appId = randomUUID();
  const text = await callRiService('extract_text', { fileName: 'confirmation.txt', mimeType: 'text/plain', base64: Buffer.from('Booking reference RH-4821\u0000\n\n\n\n\nCheck-in Nov 10').toString('base64') }, { appId }, signal);
  expect(text).toEqual({ text: 'Booking reference RH-4821\n\n\nCheck-in Nov 10', truncated: false, characters: 43 });
  await expect(callRiService('extract_text', { fileName: 'scan.pdf', mimeType: 'application/pdf', base64: Buffer.from('not a pdf').toString('base64') }, { appId }, signal)).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(callRiService('extract_text', { fileName: 'x.exe', mimeType: 'application/x-msdownload', base64: '' }, { appId }, signal)).rejects.toMatchObject({ code: 'invalid_input' });
});

it('reads text from a real PDF through Ri\'s parser', async () => {
  const result = await callRiService('extract_text', { fileName: 'confirmation.pdf', mimeType: 'application/pdf', base64: 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA2NyA+PgpzdHJlYW0KQlQgL0YxIDE4IFRmIDcyIDcyMCBUZCAoUml2ZXJzaWRlIEhvdXNlIGNvbmZpcm1hdGlvbiBSSC00ODIxKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDM1OCAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQyOAolJUVPRgo=' }, { appId: randomUUID() }, signal) as { text: string };
  expect(result.text).toContain('Riverside House confirmation RH-4821');
}, 20000);

it('lists what each service does: none reaches outside, and the writes change only the person\'s own Ri data', () => {
  expect(Object.keys(RI_SERVICE_REACH).sort()).toEqual([...RI_SERVICE_NAMES].sort());
  expect(Object.values(RI_SERVICE_REACH).every(reach => reach === 'read' || reach === 'own')).toBe(true);
  expect([...RI_SERVICE_WRITES].sort()).toEqual(['create_note', 'create_task']);
});

