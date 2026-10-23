import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { makeDocx, makePptx, makeZip } from '@/test/fixtures/zip';
import { previewContents } from './preview';
import { zipEntries, archiveEntries, checkOfficeContainer } from './archives';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-file-preview-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });
async function preview(name: string, value: string | Buffer) { const bytes = Buffer.from(value); const file = path.join(dir, name); await fs.writeFile(file, bytes); return previewContents(file, name, bytes.length); }

it('reads CSV quotes, newlines, tabs, empty cells and formula-looking text without evaluation', async () => {
  const csv = await preview('data.csv', 'name,note,empty\r\nAlex,"First line\nSecond, line",\r\n=1+1,value,\r\n');
  expect(csv).toMatchObject({ kind: 'table', sheets: [{ rows: [['name', 'note', 'empty'], ['Alex', 'First line\nSecond, line', ''], ['=1+1', 'value', '']] }], truncated: false });
  expect(await preview('data.tsv', 'name\tquantity\nWidget\t5')).toMatchObject({ kind: 'table', sheets: [{ rows: [['name', 'quantity'], ['Widget', '5']] }] });
});
it('previews multiple workbook sheets, displayed values and blank sheets', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Item', 'Quantity'], ['Widget', 5]]), 'Inventory');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Empty');
  const result = await preview('data.xlsx', XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  expect(result).toMatchObject({ kind: 'table', truncated: false, sheets: [{ name: 'Inventory', rows: [['Item', 'Quantity'], ['Widget', '5']] }, { name: 'Empty', rows: [] }] });
});
it('bounds large tables and reports that some rows are omitted', async () => {
  const result = await preview('data.csv', Array.from({ length: 600 }, (_, index) => `${index},value`).join('\n'));
  expect(result).toMatchObject({ kind: 'table', truncated: true });
  if (result.kind === 'table') expect(result.sheets[0].rows).toHaveLength(500);
});
it('keeps original cell coordinates when a sheet starts beyond A1', async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.sheet_add_aoa(sheet, [['Owner', 'Alex']], { origin: 'C3' });
  sheet['!ref'] = 'C3:D3';
  XLSX.utils.book_append_sheet(workbook, sheet, 'People');
  const result = await preview('offset.xlsx', XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  expect(result).toMatchObject({ kind: 'table', sheets: [{ rowOffset: 2, columnOffset: 2, rows: [['Owner', 'Alex']] }], truncated: false });
});
it('renders real DOCX structure and reads real PPTX slide content', async () => {
  const doc = await preview('review.docx', makeDocx());
  expect(doc).toMatchObject({ kind: 'document' });
  if (doc.kind === 'document') { expect(doc.html).toContain('Friday review'); expect(doc.html).toContain('<strong>Next steps</strong>'); }
  expect(await preview('review.pptx', makePptx())).toMatchObject({ kind: 'slides', slides: [{ title: 'Slide 1', text: expect.stringContaining('Ship the review') }] });
});
it('lists zip and compressed tar entries without unpacking them', async () => {
  const zip = makeZip({ 'docs/hello.txt': 'Hello', 'empty.txt': '' });
  expect(await zipEntries(zip)).toEqual({ entries: [{ name: 'docs/hello.txt', size: 5, directory: false }, { name: 'empty.txt', size: 0, directory: false }], truncated: false });
  expect((await zipEntries(zip, 1)).truncated).toBe(true);
  await fs.writeFile(path.join(dir, 'hello.txt'), 'Hello');
  const { c } = await import('tar');
  const chunks: Buffer[] = [];
  for await (const chunk of c({ cwd: dir, gzip: true }, ['hello.txt'])) chunks.push(Buffer.from(chunk));
  expect(await archiveEntries(Buffer.concat(chunks), 'files.tgz')).toMatchObject({ entries: [{ name: 'hello.txt', size: 5 }], truncated: false });
  expect(await preview('broken.zip', 'not a zip')).toMatchObject({ kind: 'file', reason: expect.stringContaining('could not be previewed') });
});
it('rejects oversized Office expansion before handing bytes to a parser', async () => {
  const zip = makeZip({ 'word/document.xml': 'safe' });
  const directory = zip.indexOf(Buffer.from('504b0102', 'hex'));
  zip.writeUInt32LE(100 * 1024 * 1024, directory + 24);
  await expect(checkOfficeContainer(zip)).rejects.toThrow('too large');
});
it('provides metadata for unknown formats and text for extensionless files', async () => {
  expect(await preview('README', '# Read me')).toMatchObject({ kind: 'text', content: '# Read me' });
  expect(await preview('artifact.bin', Buffer.from([0, 1, 2]))).toMatchObject({ kind: 'file', size: 3 });
  expect(await preview('binary.txt', Buffer.from([0, 1, 2]))).toMatchObject({ kind: 'file', reason: expect.stringContaining('binary') });
  expect(await previewContents('/does-not-exist', 'huge.docx', 20 * 1024 * 1024)).toMatchObject({ kind: 'file', reason: expect.stringContaining('size limit') });
});
