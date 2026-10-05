import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import type { Attachment } from '@/db/types';
import { placeFilesAtHome } from '@/lib/executor/input-files';
import { expandMarkers } from './expand-markers';
import { attachmentPath, saveAttachment } from './save';

/** A real zip archive holding one stored file, `hello.txt`. */
function zipBytes(): Buffer {
  const name = Buffer.from('hello.txt');
  const data = Buffer.from('hello from the zip\n');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

function crc32(bytes: Buffer): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/** A real workbook, which is a zip container. */
function xlsxBytes(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['name', 'qty'], ['widget', 5]]), 'Inventory');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('expandMarkers', () => {
  it('leaves a file the agent reads itself for dispatch to place', async () => {
    const notes = await saveAttachment({ data: Buffer.from('shopping list'), originalName: 'notes.txt', mimeType: 'text/plain' });
    const content = `read [[file:${notes.fileName}]]`;
    expect(await expandMarkers(content, [notes])).toBe(content);
  });

  it('hands a zip archive to the agent as its path, whichever name the browser gave the mime', async () => {
    for (const mimeType of ['application/zip', 'application/x-zip-compressed']) {
      const zip = await saveAttachment({ data: zipBytes(), originalName: 'backup.zip', mimeType });
      expect(zip).toMatchObject({ mimeType: 'application/zip', originalName: 'backup.zip' });
      expect(zip.fileName).toMatch(/\.zip$/);

      const content = `unpack [[file:${zip.fileName}]] please`;
      const expanded = await expandMarkers(content, [zip]);
      // The marker survives expansion: no extraction, no "unreadable" stub.
      expect(expanded).toBe(content);
      const placed = placeFilesAtHome(expanded, [zip]);
      expect(placed).toBe(`unpack ${attachmentPath(zip.fileName)} please`);
      expect(fs.readFileSync(attachmentPath(zip.fileName)).equals(zipBytes())).toBe(true);
    }
  });

  it('never sends a real archive into an Office parser, even one with nothing readable inside', async () => {
    // Bytes no parser could open. Reaching one would turn the marker into an extract-error stub.
    const junk = await saveAttachment({ data: Buffer.from('PK\u0003\u0004 not really a zip'), originalName: 'broken.zip', mimeType: 'application/zip' });
    const content = `[[file:${junk.fileName}]]`;
    expect(await expandMarkers(content, [junk])).toBe(content);
  });

  it('extracts an Office document uploaded under the zip mime, as the document it is', async () => {
    const sheet = await saveAttachment({ data: xlsxBytes(), originalName: 'budget.xlsx', mimeType: 'application/zip' });
    expect(sheet.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(sheet.fileName).toMatch(/\.xlsx$/);

    const expanded = await expandMarkers(`see [[file:${sheet.fileName}]]`, [sheet]);
    expect(expanded).toContain('<attachment filename="budget.xlsx">');
    expect(expanded).toContain('## Sheet: Inventory');
    expect(expanded).toContain('widget,5');
    expect(expanded).not.toContain('[[file:');
  });

  it('still extracts by name when a stored record kept the zip mime', async () => {
    const saved = await saveAttachment({ data: xlsxBytes(), originalName: 'budget.xlsx', mimeType: 'application/zip' });
    const mislabeled: Attachment = { ...saved, mimeType: 'application/zip' };
    const expanded = await expandMarkers(`see [[file:${mislabeled.fileName}]]`, [mislabeled]);
    expect(expanded).toContain('<attachment filename="budget.xlsx">');
    expect(expanded).toContain('widget,5');
  });

  it('marks a file with no extractor as unreadable', async () => {
    const clip: Attachment = { fileName: 'clip.mp4', originalName: 'clip.mp4', mimeType: 'video/mp4', size: 4, uploadedAt: '2026-10-05T00:00:00.000Z' };
    expect(await expandMarkers('[[file:clip.mp4]]', [clip])).toBe('<attachment filename="clip.mp4" status="unreadable" />');
  });
});
