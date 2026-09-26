import { describe, expect, it } from 'vitest';
import { readLimitedRequestBody } from '@/lib/webhooks/read-limited-body';
import { MAX_MULTIPART_BYTES, readLimitedFormData, readLimitedJson } from './limited-body';

describe('bounded request ingestion', () => {
  it('cancels an oversized streaming body without trusting content-length', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(4)); },
      cancel() { cancelled = true; },
    });
    const request = new Request('http://localhost/upload', {
      method: 'POST', body, duplex: 'half', headers: { 'content-length': '1' },
    } as RequestInit);
    await expect(readLimitedRequestBody(request, 8)).rejects.toThrow('exceeds 8');
    expect(cancelled).toBe(true);
  });
  it('parses normal uploads including filenames and text fields', async () => {
    const body = new FormData();
    body.set('file', new Blob(['image'], { type: 'image/png' }), 'my image.png');
    body.set('text', 'caption');
    const form = await readLimitedFormData(new Request('http://localhost', { method: 'POST', body }));
    expect((form.get('file') as File).name).toBe('my image.png');
    expect(await (form.get('file') as Blob).text()).toBe('image');
    expect(form.get('text')).toBe('caption');
  });
  it('rejects oversized multipart bytes before the parser sees them', async () => {
    const request = new Request('http://localhost', { method: 'POST', body: new Uint8Array(MAX_MULTIPART_BYTES + 1), headers: { 'content-type': 'multipart/form-data; boundary=x' } });
    await expect(readLimitedFormData(request)).rejects.toThrow('exceeds');
  });
  it('bounds JSON as well as file uploads', async () => {
    await expect(readLimitedJson(new Request('http://localhost', { method: 'POST', body: '{"text":"hi"}' }), 8)).rejects.toThrow('exceeds');
  });
});
