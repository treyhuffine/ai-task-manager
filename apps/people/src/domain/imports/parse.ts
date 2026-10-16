/**
 * Deterministic parsers for contact files: RFC 4180 CSV (any delimiter, quoted
 * fields, embedded newlines), vCard 2.1 to 4.0 and the LinkedIn connections
 * export. Unicode is preserved and unmapped columns are kept verbatim.
 */
export interface ParsedRow {
  index: number;
  name: string | null;
  emails: string[];
  phones: string[];
  linkedin: string | null;
  company: string | null;
  role: string | null;
  website: string | null;
  notes: string | null;
  lists: string[];
  externalId: string | null;
  observedOn: string | null;
  raw: Record<string, string>;
  unmapped: Record<string, string>;
}
export type ImportFormat = 'csv' | 'vcard' | 'linkedin';
export const MAX_ROWS = 5000;

export function decodeText(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  let text = bytes.toString('utf8');
  if (text.includes('�')) {
    const latin = bytes.toString('latin1');
    if (!/[\u0080-\u009f]/.test(latin)) text = latin;
  }
  return text.replace(/^﻿/, '').replace(/\u0000/g, '');
}

export function detectFormat(text: string): ImportFormat {
  if (/^\s*BEGIN:VCARD/im.test(text)) return 'vcard';
  if (linkedInHeaderIndex(splitLines(text)) >= 0) return 'linkedin';
  return 'csv';
}
function splitLines(text: string) {
  return text.replace(/\r\n?/g, '\n').split('\n');
}
function linkedInHeaderIndex(lines: string[]) {
  return lines.slice(0, 30).findIndex((line) => /first name/i.test(line) && /last name/i.test(line) && /(connected on|position)/i.test(line));
}

export function parseCsv(text: string, delimiter?: string): string[][] {
  const source = text.replace(/\r\n?/g, '\n');
  const firstLine = source.slice(0, source.indexOf('\n') >= 0 ? source.indexOf('\n') : source.length);
  const sep = delimiter ?? ([',', ';', '\t'].map((candidate) => [candidate, firstLine.split(candidate).length] as const).sort((a, b) => b[1] - a[1])[0][0]);
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"') { if (source[index + 1] === '"') { field += '"'; index++; } else quoted = false; }
      else field += char;
      continue;
    }
    if (char === '"' && field === '') { quoted = true; continue; }
    if (char === sep) { row.push(field); field = ''; continue; }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; if (rows.length > MAX_ROWS + 50) break; continue; }
    field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

const FIELDS: Record<string, string[]> = {
  name: ['name', 'full name', 'display name', 'contact name', 'contact'],
  first: ['first name', 'given name', 'first', 'firstname'],
  last: ['last name', 'family name', 'surname', 'last', 'lastname'],
  email: ['email', 'e-mail', 'email address', 'e-mail address', 'primary email', 'work email', 'personal email', 'e-mail 1 - value', 'e-mail 2 - value', 'email 1', 'email 2', 'emails'],
  phone: ['phone', 'mobile', 'phone number', 'telephone', 'phone 1 - value', 'mobile phone', 'work phone'],
  company: ['company', 'organization', 'organisation', 'employer', 'organization 1 - name', 'company name', 'account name', 'account'],
  role: ['title', 'job title', 'position', 'role', 'organization 1 - title'],
  website: ['website', 'web site', 'company website', 'domain', 'company domain'],
  linkedin: ['linkedin', 'linkedin url', 'profile url', 'url', 'linkedin profile'],
  notes: ['notes', 'note', 'description', 'comments'],
  lists: ['list', 'lists', 'tags', 'groups', 'labels', 'group membership', 'tag'],
  externalId: ['id', 'external id', 'record id', 'contact id', 'crm id', 'uid'],
  observedOn: ['connected on', 'created', 'created at', 'date added'],
};
export function mapHeaders(headers: string[]): Record<number, string> {
  const mapping: Record<number, string> = {};
  const taken = new Set<string>();
  headers.forEach((header, index) => {
    const key = header.trim().toLowerCase().replace(/\s+/g, ' ');
    for (const [field, names] of Object.entries(FIELDS)) {
      if (!names.includes(key)) continue;
      if (taken.has(field) && !['email', 'phone', 'lists'].includes(field)) continue;
      mapping[index] = field;
      taken.add(field);
      break;
    }
  });
  return mapping;
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

export function rowsFromTable(table: string[][], format: ImportFormat): { rows: ParsedRow[]; headers: string[]; mapping: Record<string, string>; truncated: boolean } {
  let start = 0;
  if (format === 'linkedin') start = Math.max(0, table.findIndex((cells) => cells.some((cell) => /first name/i.test(cell)) && cells.some((cell) => /last name/i.test(cell))));
  const headers = (table[start] ?? []).map((cell) => cell.trim());
  const mapping = mapHeaders(headers);
  const body = table.slice(start + 1);
  const rows: ParsedRow[] = body.slice(0, MAX_ROWS).map((cells, offset) => {
    const raw: Record<string, string> = {}, unmapped: Record<string, string> = {};
    const values: Record<string, string[]> = {};
    headers.forEach((header, index) => {
      const value = (cells[index] ?? '').trim();
      const label = header || `Column ${index + 1}`;
      raw[label] = value;
      const field = mapping[index];
      if (!field) { if (value) unmapped[label] = value; return; }
      if (value) (values[field] ??= []).push(value);
    });
    const first = values.first?.[0] ?? '', last = values.last?.[0] ?? '';
    const name = (values.name?.[0] ?? [first, last].filter(Boolean).join(' ')).trim() || null;
    const linkedinCandidates = [...(values.linkedin ?? []), ...Object.values(raw)].filter((value) => /linkedin\.com\//i.test(value));
    const emails = (values.email ?? []).flatMap((value) => value.split(/[;,\s]+|:::/)).map((value) => value.trim()).filter(Boolean);
    return {
      index: offset + 1,
      name,
      emails: [...new Set(emails)].slice(0, 5),
      phones: (values.phone ?? []).flatMap((value) => value.split(/;|:::/)).map((value) => value.trim()).filter(Boolean).slice(0, 3),
      linkedin: linkedinCandidates[0] ?? null,
      company: values.company?.[0] ?? null,
      role: values.role?.[0] ?? null,
      website: values.website?.[0] ?? null,
      notes: values.notes?.join('\n') ?? null,
      lists: (values.lists ?? []).flatMap((value) => value.split(/[;|]|:::|,(?=\s*\S)/)).map((value) => value.replace(/^\*\s*/, '').trim()).filter((value) => value && !/^\* ?my contacts$/i.test(value)).slice(0, 10),
      externalId: values.externalId?.[0] ?? null,
      observedOn: isoDate(values.observedOn?.[0] ?? null),
      raw,
      unmapped,
    };
  });
  const named: Record<string, string> = {};
  for (const [index, field] of Object.entries(mapping)) named[headers[Number(index)] || `Column ${Number(index) + 1}`] = field;
  return { rows, headers, mapping: named, truncated: body.length > MAX_ROWS };
}

// ─── vCard ───────────────────────────────────────────────────────────────────

function unescapeValue(value: string) {
  return value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}
function decodeQuotedPrintable(value: string, charset: string) {
  const bytes: number[] = [];
  const text = value.replace(/=\n/g, '');
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '=' && /^[0-9A-Fa-f]{2}$/.test(text.slice(index + 1, index + 3))) { bytes.push(parseInt(text.slice(index + 1, index + 3), 16)); index += 2; }
    else bytes.push(...Buffer.from(text[index], 'utf8'));
  }
  try { return new TextDecoder(charset || 'utf-8').decode(new Uint8Array(bytes)); } catch { return Buffer.from(bytes).toString('utf8'); }
}

export function parseVcards(text: string): { rows: ParsedRow[]; truncated: boolean } {
  const unfolded = text.replace(/\r\n?/g, '\n').replace(/=\n/g, '=\n').replace(/\n[ \t]/g, '');
  const cards = unfolded.split(/^BEGIN:VCARD\s*$/im).slice(1).map((chunk) => chunk.split(/^END:VCARD\s*$/im)[0]);
  const rows: ParsedRow[] = cards.slice(0, MAX_ROWS).map((card, offset) => {
    const props: { name: string; params: Record<string, string>; value: string }[] = [];
    for (const line of card.split('\n')) {
      const match = /^(?:[A-Za-z0-9-]+\.)?([A-Za-z-]+)((?:;[^:]*)?):(.*)$/.exec(line.trim());
      if (!match) continue;
      const params: Record<string, string> = {};
      for (const part of match[2].split(';').filter(Boolean)) { const [key, value] = part.split('='); params[key.toUpperCase()] = value ?? key; }
      let value = match[3];
      if ((params.ENCODING ?? '').toUpperCase() === 'QUOTED-PRINTABLE') value = decodeQuotedPrintable(value, params.CHARSET ?? 'utf-8');
      props.push({ name: match[1].toUpperCase(), params, value });
    }
    const all = (name: string) => props.filter((prop) => prop.name === name).map((prop) => unescapeValue(prop.value).trim()).filter(Boolean);
    const one = (name: string) => all(name)[0] ?? null;
    const n = one('N')?.split(';') ?? [];
    const name = one('FN') ?? ([n[1], n[0]].filter(Boolean).join(' ') || null);
    const raw: Record<string, string> = {};
    for (const prop of props) raw[prop.name] = raw[prop.name] ? `${raw[prop.name]}; ${unescapeValue(prop.value)}` : unescapeValue(prop.value);
    const known = new Set(['FN', 'N', 'EMAIL', 'TEL', 'ORG', 'TITLE', 'NOTE', 'URL', 'CATEGORIES', 'UID', 'VERSION', 'PRODID', 'REV']);
    const unmapped = Object.fromEntries(Object.entries(raw).filter(([key]) => !known.has(key)));
    const urls = all('URL');
    return {
      index: offset + 1,
      name,
      emails: [...new Set(all('EMAIL').map((value) => value.replace(/^mailto:/i, '')))].slice(0, 5),
      phones: all('TEL').map((value) => value.replace(/^tel:/i, '')).slice(0, 3),
      linkedin: urls.find((url) => /linkedin\.com\//i.test(url)) ?? null,
      company: one('ORG')?.split(';')[0]?.trim() || null,
      role: one('TITLE'),
      website: urls.find((url) => !/linkedin\.com\//i.test(url)) ?? null,
      notes: one('NOTE'),
      lists: (one('CATEGORIES') ?? '').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 10),
      externalId: one('UID'),
      observedOn: null,
      raw,
      unmapped,
    };
  });
  return { rows, truncated: cards.length > MAX_ROWS };
}
