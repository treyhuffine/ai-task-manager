import fs from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { ensureAttachmentsDir } from '@/lib/config/paths';
import path from 'node:path';
import { GET } from './[fileName]/route';

const files: string[] = [];
afterEach(() => { for (const file of files.splice(0)) fs.unlinkSync(file); });
it('isolates an uploaded active SVG while retaining image delivery', async () => {
  const fileName = 'sandbox-regression.svg';
  const file = path.join(ensureAttachmentsDir(), fileName);
  fs.writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/user-state")</script></svg>');
  files.push(file);
  const response = await GET(new NextRequest(`http://localhost/api/attachments/${fileName}`), { params: Promise.resolve({ fileName }) });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/svg+xml');
  expect(response.headers.get('content-security-policy')).toMatch(/^sandbox;/);
  expect(response.headers.get('content-security-policy')).not.toContain('allow-scripts');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});
