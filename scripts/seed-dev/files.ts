/**
 * Attachment files for the dev seed, generated on the spot so nothing binary
 * lives in the repo: charts and mockups drawn as SVG and rendered to PNG with
 * sharp, a one-page PDF written by hand, and a CSV. Each is stored through
 * the app's own `saveAttachment`, so it gets a UUIDv7 name in the home's
 * attachments folder and a real `Attachment` record.
 *
 * Seed content refers to them by friendly name (`{{file:roast-curve-guji.png}}`).
 * The runner swaps that for the app's `[[file:<file_name>]]` marker.
 */

import type { Attachment } from '../../src/db/types';

export const SEED_FILE_NAMES = [
  'roast-curve-guji.png',
  'backsplash-options.png',
  'fieldnote-onboarding.png',
  'insurance-renewal.pdf',
  'long-run-splits.csv',
  'sync-bug-screenshot.png',
] as const;
export type SeedFileName = (typeof SEED_FILE_NAMES)[number];

const FONT = "font-family='Helvetica Neue, Helvetica, Arial, sans-serif'";

function roastCurveSvg(): string {
  // Bean temperature, environment temperature and rate of rise for a
  // 10:52 roast. Seconds on x, Fahrenheit on y.
  const W = 1200, H = 700, L = 90, R = 60, T = 80, B = 90;
  const xs = (s: number) => L + (s / 660) * (W - L - R);
  const ys = (f: number) => H - B - ((f - 150) / (480 - 150)) * (H - T - B);
  const ror = (v: number) => H - B - (v / 40) * (H - T - B);
  const bt: Array<[number, number]> = [];
  const et: Array<[number, number]> = [];
  const rr: Array<[number, number]> = [];
  for (let s = 0; s <= 652; s += 4) {
    const turning = s < 75 ? 410 - (s / 75) * 230 : 180 + 230 * (1 - Math.exp(-(s - 75) / 260));
    const btv = Math.min(turning, 412 + (s - 600) * 0.05);
    bt.push([s, btv]);
    et.push([s, 430 + 25 * Math.sin(s / 140) - (s < 60 ? 40 * (1 - s / 60) : 0)]);
    if (s > 80) rr.push([s, Math.max(4, 34 * Math.exp(-(s - 90) / 330))]);
  }
  const line = (pts: Array<[number, number]>, y: (v: number) => number) =>
    pts.map(([s, v], i) => `${i ? 'L' : 'M'}${xs(s).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const grid = [200, 250, 300, 350, 400, 450].map((f) =>
    `<line x1='${L}' x2='${W - R}' y1='${ys(f)}' y2='${ys(f)}' stroke='#2a2f2a'/><text x='${L - 12}' y='${ys(f) + 5}' fill='#8a948a' font-size='16' text-anchor='end' ${FONT}>${f}°</text>`).join('');
  const minutes = [0, 2, 4, 6, 8, 10].map((m) =>
    `<text x='${xs(m * 60)}' y='${H - B + 30}' fill='#8a948a' font-size='16' text-anchor='middle' ${FONT}>${m}:00</text>`).join('');
  const marker = (s: number, label: string) =>
    `<line x1='${xs(s)}' x2='${xs(s)}' y1='${T}' y2='${H - B}' stroke='#d6a65a' stroke-dasharray='6 6'/><text x='${xs(s) + 8}' y='${T + 22}' fill='#d6a65a' font-size='16' ${FONT}>${label}</text>`;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'>
    <rect width='100%' height='100%' fill='#141714'/>
    <text x='${L}' y='44' fill='#e8ece8' font-size='26' font-weight='600' ${FONT}>Guji natural, batch 214 (15 kg charge)</text>
    <text x='${W - R}' y='44' fill='#8a948a' font-size='18' text-anchor='end' ${FONT}>Drop 10:52 at 412°F, development 19.4%</text>
    ${grid}${minutes}
    ${marker(388, 'Dry end 6:28')}${marker(527, 'First crack 8:47')}
    <path d='${line(et, ys)}' fill='none' stroke='#c2563a' stroke-width='3'/>
    <path d='${line(bt, ys)}' fill='none' stroke='#5aa6d6' stroke-width='4'/>
    <path d='${line(rr, ror)}' fill='none' stroke='#7fbf6a' stroke-width='3' stroke-dasharray='2 0'/>
    <g ${FONT} font-size='17'>
      <rect x='${L + 20}' y='${H - B - 112}' width='250' height='96' rx='8' fill='#1c201c' stroke='#2a2f2a'/>
      <circle cx='${L + 42}' cy='${H - B - 84}' r='6' fill='#5aa6d6'/><text x='${L + 58}' y='${H - B - 78}' fill='#e8ece8'>Bean temp</text>
      <circle cx='${L + 42}' cy='${H - B - 58}' r='6' fill='#c2563a'/><text x='${L + 58}' y='${H - B - 52}' fill='#e8ece8'>Environment temp</text>
      <circle cx='${L + 42}' cy='${H - B - 32}' r='6' fill='#7fbf6a'/><text x='${L + 58}' y='${H - B - 26}' fill='#e8ece8'>Rate of rise (°F/min)</text>
    </g>
  </svg>`;
}

function backsplashSvg(): string {
  const swatch = (x: number, title: string, note: string, body: string) => `
    <g transform='translate(${x},90)'>
      <rect width='340' height='340' rx='14' fill='#f4f1ea'/>
      <clipPath id='c${x}'><rect width='340' height='340' rx='14'/></clipPath>
      <g clip-path='url(#c${x})'>${body}</g>
      <text x='0' y='390' fill='#2b2a27' font-size='24' font-weight='600' ${FONT}>${title}</text>
      <text x='0' y='422' fill='#6b675f' font-size='18' ${FONT}>${note}</text>
    </g>`;
  let zellige = '';
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
    const g = 150 + ((r * 7 + c * 13) % 5) * 12;
    zellige += `<rect x='${c * 57 + 2}' y='${r * 57 + 2}' width='53' height='53' rx='3' fill='rgb(${g - 60},${g + 20},${g + 10})'/>`;
  }
  let subway = '';
  for (let r = 0; r < 12; r++) for (let c = -1; c < 4; c++) {
    subway += `<rect x='${c * 100 + (r % 2) * 50 + 2}' y='${r * 30 + 2}' width='96' height='26' fill='#fbfaf7' stroke='#d8d4ca'/>`;
  }
  let hex = '';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 7; c++) {
    const cx = c * 52 + (r % 2) * 26, cy = r * 45;
    const pts = [0, 60, 120, 180, 240, 300].map((a) => `${cx + 28 * Math.cos((a * Math.PI) / 180)},${cy + 28 * Math.sin((a * Math.PI) / 180)}`).join(' ');
    hex += `<polygon points='${pts}' fill='${(r + c) % 3 ? '#c86f4a' : '#b85d3c'}' stroke='#f4f1ea' stroke-width='3'/>`;
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' width='1180' height='560'>
    <rect width='100%' height='100%' fill='#ffffff'/>
    <text x='40' y='56' fill='#2b2a27' font-size='28' font-weight='600' ${FONT}>Backsplash options (samples from Tile Shop, Oct 2)</text>
    ${swatch(40, 'Zellige, sea glass', '$38/sq ft, uneven on purpose', zellige)}
    ${swatch(420, 'Subway, matte white', '$9/sq ft, safe, a bit plain', subway)}
    ${swatch(800, 'Hex, terracotta', '$22/sq ft, Theo loves it', hex)}
  </svg>`;
}

function phone(x: number, title: string, line1: string, line2: string, accent: string, art: string): string {
  return `<g transform='translate(${x},40)'>
    <rect width='300' height='620' rx='42' fill='#0f1210' stroke='#2c332d' stroke-width='6'/>
    <rect x='110' y='16' width='80' height='22' rx='11' fill='#000'/>
    <g transform='translate(0,90)'>${art}</g>
    <text x='150' y='430' fill='#f2f5f2' font-size='26' font-weight='700' text-anchor='middle' ${FONT}>${title}</text>
    <text x='150' y='468' fill='#9aa59b' font-size='17' text-anchor='middle' ${FONT}>${line1}</text>
    <text x='150' y='494' fill='#9aa59b' font-size='17' text-anchor='middle' ${FONT}>${line2}</text>
    <rect x='40' y='540' width='220' height='50' rx='25' fill='${accent}'/>
    <text x='150' y='572' fill='#0f1210' font-size='18' font-weight='700' text-anchor='middle' ${FONT}>Continue</text>
  </g>`;
}

function onboardingSvg(): string {
  const mic = `<circle cx='150' cy='150' r='92' fill='#1f3b2a'/><rect x='126' y='88' width='48' height='92' rx='24' fill='#7fd19b'/><path d='M104 150 a46 46 0 0 0 92 0' fill='none' stroke='#7fd19b' stroke-width='8'/><rect x='146' y='196' width='8' height='30' fill='#7fd19b'/>`;
  const cloud = `<circle cx='150' cy='150' r='92' fill='#1f2e3b'/><path d='M95 175 h110 a32 32 0 0 0 -10 -62 a44 44 0 0 0 -84 10 a26 26 0 0 0 -16 52z' fill='#8cc4ef'/><line x1='92' y1='92' x2='212' y2='212' stroke='#ef8c8c' stroke-width='10' stroke-linecap='round'/>`;
  const list = `<circle cx='150' cy='150' r='92' fill='#3b321f'/>${[0, 1, 2].map((i) => `<rect x='98' y='${108 + i * 32}' width='18' height='18' rx='4' fill='#efc98c'/><rect x='126' y='${110 + i * 32}' width='80' height='14' rx='7' fill='#efc98c' opacity='0.7'/>`).join('')}`;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='700'>
    <rect width='100%' height='100%' fill='#e9ede9'/>
    ${phone(60, 'Hear a bird? Just talk.', 'Say what you saw and where.', 'Fieldnote does the typing.', '#7fd19b', mic)}
    ${phone(390, 'Works offline', 'Log on the trail with no signal.', 'It syncs when you are back.', '#8cc4ef', cloud)}
    ${phone(720, 'Your life list', 'Every species, every place,', 'searchable by voice.', '#efc98c', list)}
  </svg>`;
}

function syncBugSvg(): string {
  const row = (y: number, name: string, place: string, state: string, color: string) => `
    <g transform='translate(24,${y})'><rect width='292' height='70' rx='12' fill='#1a1f1b'/>
    <text x='16' y='30' fill='#eef2ee' font-size='19' font-weight='600' ${FONT}>${name}</text>
    <text x='16' y='54' fill='#8f9a90' font-size='15' ${FONT}>${place}</text>
    <text x='276' y='38' fill='${color}' font-size='14' text-anchor='end' ${FONT}>${state}</text></g>`;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='340' height='700'>
    <rect width='100%' height='100%' rx='40' fill='#0f1210'/>
    <text x='24' y='70' fill='#eef2ee' font-size='28' font-weight='700' ${FONT}>Today</text>
    <text x='24' y='98' fill='#ef8c8c' font-size='15' ${FONT}>Offline. 3 sightings waiting to sync</text>
    ${row(120, 'Cedar Waxwing', 'Riverside trail, 7:42 AM', 'Waiting', '#efc98c')}
    ${row(200, 'Belted Kingfisher', 'Riverside trail, 7:58 AM', 'Waiting', '#efc98c')}
    ${row(280, 'Red-tailed Hawk', 'Old quarry, 8:20 AM', 'Uploading', '#8cc4ef')}
    <rect x='24' y='380' width='292' height='120' rx='12' fill='#2a1717'/>
    <text x='40' y='414' fill='#ef8c8c' font-size='16' font-weight='700' ${FONT}>After reopening the app:</text>
    <text x='40' y='442' fill='#e6caca' font-size='15' ${FONT}>Kingfisher and Hawk are gone.</text>
    <text x='40' y='466' fill='#e6caca' font-size='15' ${FONT}>Only the Waxwing synced.</text>
  </svg>`;
}

/** A one-page PDF with a few lines of text, built by hand (no PDF library needed). */
function insurancePdf(): Buffer {
  const lines = [
    ['F2', 20, 'Harbor Mutual Insurance'],
    ['F1', 13, 'Homeowners policy renewal notice'],
    ['F1', 11, ''],
    ['F1', 11, 'Policy HM-44821-B    Insured: Maya Okafor and Theo Brandt'],
    ['F1', 11, 'Property: 1924 bungalow, 418 Linden Street'],
    ['F1', 11, ''],
    ['F2', 12, 'Your renewal premium: $1,842 per year (was $1,659, up 11 percent)'],
    ['F1', 11, 'Dwelling coverage: $412,000    Deductible: $2,500'],
    ['F1', 11, 'Roof surcharge applied: roof age over 20 years'],
    ['F1', 11, ''],
    ['F1', 11, 'To keep coverage, pay by the renewal date shown on your account.'],
    ['F1', 11, 'Questions? Call your agent, Rosa Delgado, at 555-0142.'],
  ] as const;
  let y = 740;
  const text = lines.map(([font, size, s]) => {
    const out = `BT /${font} ${size} Tf 72 ${y} Td (${s.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj ET`;
    y -= size + 10;
    return out;
  }).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function splitsCsv(): Buffer {
  const rows = ['mile,pace,avg_hr,elevation_ft,notes'];
  const paces = ['9:12', '9:05', '9:01', '8:58', '9:03', '8:55', '8:57', '9:10', '9:02', '8:51', '8:49', '8:56', '9:14', '9:20', '9:08', '8:59'];
  paces.forEach((p, i) => rows.push(`${i + 1},${p},${142 + Math.min(i, 12) + (i === 12 ? 6 : 0)},${[12, 30, -8, 4, 41, -22, 6, 0, 18, -12, 3, 9, 55, 20, -30, -15][i]},${i === 12 ? 'calf tight on the hill' : i === 9 ? 'gel' : ''}`));
  return Buffer.from(rows.join('\n') + '\n');
}

export async function generateSeedFiles(): Promise<Record<SeedFileName, Attachment>> {
  const sharp = (await import('sharp')).default;
  const { saveAttachment } = await import('../../src/lib/attachments/save');
  const png = async (svg: string) => sharp(Buffer.from(svg)).png().toBuffer();
  const make: Record<SeedFileName, () => Promise<{ data: Buffer; mimeType: string }>> = {
    'roast-curve-guji.png': async () => ({ data: await png(roastCurveSvg()), mimeType: 'image/png' }),
    'backsplash-options.png': async () => ({ data: await png(backsplashSvg()), mimeType: 'image/png' }),
    'fieldnote-onboarding.png': async () => ({ data: await png(onboardingSvg()), mimeType: 'image/png' }),
    'sync-bug-screenshot.png': async () => ({ data: await png(syncBugSvg()), mimeType: 'image/png' }),
    'insurance-renewal.pdf': async () => ({ data: insurancePdf(), mimeType: 'application/pdf' }),
    'long-run-splits.csv': async () => ({ data: splitsCsv(), mimeType: 'text/csv' }),
  };
  const out = {} as Record<SeedFileName, Attachment>;
  for (const name of SEED_FILE_NAMES) {
    const { data, mimeType } = await make[name]();
    out[name] = await saveAttachment({ data, originalName: name, mimeType });
  }
  return out;
}

/** The app's marker for a stored file. */
export function fileMarker(attachment: Attachment): string {
  return `[[file:${attachment.fileName}]]`;
}
