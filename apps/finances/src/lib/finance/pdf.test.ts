import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { financePdfText } from './pdf';
function invoice() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 16 Tf 20 200 Td (Fictional invoice USD 19.99) Tj ET';
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, obj] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((o) => String(o).padStart(10, '0') + ' 00000 n \n')
      .join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
describe('isolated invoice parser', () => {
  it.skipIf(
    process.platform !== 'darwin' || !existsSync('/opt/homebrew/bin/pdftotext'),
  )(
    'extracts only the supplied invoice in the parser process profile',
    async () => {
      expect(await financePdfText(invoice())).toContain(
        'Fictional invoice USD 19.99',
      );
    },
  );
  it('rejects oversized input before parsing', async () => {
    await expect(
      financePdfText(Buffer.alloc(5 * 1024 * 1024 + 1)),
    ).rejects.toThrow(
      process.platform === 'darwin' ? 'too large' : 'not qualified',
    );
  });
});
