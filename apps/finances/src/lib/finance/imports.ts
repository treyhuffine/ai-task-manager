import { createHash } from 'node:crypto';
import { parseMoney } from './money';
import { dateOnly, transactionSchema } from './contracts';

/** Bounded RFC 4180 parser. A quoted newline belongs to its field. */
export function parseFinanceCsv(text: string): string[][] {
  if (Buffer.byteLength(text) > 5 * 1024 * 1024)
    throw new Error('CSV exceeds 5 MiB');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (!field.length || quoted) quoted = !quoted;
      else throw new Error('Invalid CSV quoting');
    } else if (c === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.length)) rows.push(row);
      row = [];
      field = '';
    } else field += c;
    if (rows.length > 20000 || field.length > 24000)
      throw new Error('CSV record limit exceeded');
  }
  if (quoted) throw new Error('Unclosed CSV field');
  row.push(field);
  if (row.some((f) => f.length)) rows.push(row);
  if (!rows.length) throw new Error('CSV is empty');
  const width = rows[0].length;
  if (rows.some((r) => r.length !== width))
    throw new Error('CSV rows have different column counts');
  return rows;
}
export function normalizeFinanceCsv(input: {
  text: string;
  accountId: string;
  currency: string;
  columns?: {
    date: string;
    merchant: string;
    amount: string;
    category?: string;
  };
  positiveMeansSpending: boolean;
}) {
  const rows = parseFinanceCsv(input.text),
    headers = rows.shift()!.map((h) => h.replace(/^\uFEFF/, '').trim());
  const columns = input.columns ?? {
    date: 'date',
    merchant: 'merchant',
    amount: 'amount',
    category: 'category',
  };
  const find = (name: string) =>
    headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const date = find(columns.date),
    merchant = find(columns.merchant),
    amount = find(columns.amount),
    category = columns.category ? find(columns.category) : -1;
  if ([date, merchant, amount].some((i) => i < 0))
    throw new Error('Select date, merchant and amount columns');
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const postedOn = dateOnly.parse(row[date].trim()),
      amountMinor =
        parseMoney(row[amount], input.currency) *
        (input.positiveMeansSpending ? 1 : -1),
      merchantText = row[merchant].trim();
    const signature = createHash('sha256')
      .update(
        JSON.stringify([
          input.accountId,
          postedOn,
          amountMinor,
          merchantText.toLowerCase(),
        ]),
      )
      .digest('hex');
    const occurrence = seen.get(signature) ?? 0;
    seen.set(signature, occurrence + 1);
    return transactionSchema.parse({
      accountId: input.accountId,
      sourceId: `csv:${signature}:${occurrence}`,
      amountMinor,
      currency: input.currency,
      postedOn,
      authorizedOn: null,
      merchant: merchantText,
      category: category < 0 ? 'other' : row[category].trim() || 'other',
      kind: amountMinor < 0 ? 'refund' : 'purchase',
      state: 'posted',
      pendingSourceId: null,
      obligationId: null,
      refundOf: null,
    });
  });
}
export function exportFinanceCsv(
  rows: {
    postedOn: string;
    merchant: string;
    amountMinor: number;
    currency: string;
    category: string;
    kind: string;
    state: string;
    sourceId: string;
  }[],
): string {
  const cell = (v: string | number) => {
    const text = String(v),
      safe =
        typeof v === 'string' && /^[=+@\t\r-]/.test(text) ? "'" + text : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [
    'date,merchant,amount_minor,currency,category,kind,state,source_id',
    ...rows.map((r) =>
      [
        r.postedOn,
        r.merchant,
        r.amountMinor,
        r.currency,
        r.category,
        r.kind,
        r.state,
        r.sourceId,
      ]
        .map(cell)
        .join(','),
    ),
  ].join('\r\n');
}
