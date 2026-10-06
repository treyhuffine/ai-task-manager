import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// Uses the artifact runtime package rather than application dependencies.
const auditDir = path.dirname(fileURLToPath(import.meta.url));
const previewOnly = process.argv.includes('--preview-only');
const prototype = process.argv.includes('--prototype');
const inputArg = process.argv.find((arg) => arg.startsWith('--input='));
const inputPath = inputArg?.slice('--input='.length) ?? path.join(auditDir, prototype ? 'directory-facts.json' : 'audit.json');
const runtimeDir = path.join(os.tmpdir(), 'claude-connector-audit-runtime');
const dependencyDir = process.env.ARTIFACT_NODE_MODULES ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
await fs.mkdir(runtimeDir, { recursive: true });
try {
  await fs.symlink(dependencyDir, path.join(runtimeDir, 'node_modules'), 'dir');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
const requireArtifact = createRequire(path.join(runtimeDir, 'package.json'));
const { Workbook, SpreadsheetFile } = await import(pathToFileURL(requireArtifact.resolve('@oai/artifact-tool')).href);
const raw = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const audit = prototype ? { rows: raw, backlog: [], summary: {} } : raw;
if (!Array.isArray(audit.rows) || !Array.isArray(audit.backlog)) throw new Error('Expected rows and backlog arrays.');
if (!prototype && audit.rows.length !== 861) throw new Error(`Expected all 861 directory records, received ${audit.rows.length}.`);
if (new Set(audit.rows.map((row) => row.slug)).size !== audit.rows.length) throw new Error('Connector slugs must be unique.');
if (!prototype && !audit.backlog.length) throw new Error('A populated prioritized backlog is required.');

const colors = {
  ink: '#243247', header: '#23364D', blue: '#315C88', muted: '#607185',
  line: '#D7DFE8', light: '#F3F6F9', purple: '#ECE7F6',
  urgent: '#FBE7DF', amber: '#FFF1D5', green: '#E7F1ED',
};
const workbook = Workbook.create();
const backlogSheet = workbook.worksheets.add('Backlog');
const inventorySheet = workbook.worksheets.add('All connectors');
const methodSheet = workbook.worksheets.add('Method and legend');
backlogSheet.tabColor = colors.header;
inventorySheet.tabColor = colors.blue;
methodSheet.tabColor = '#8795A4';
const columnLetter = (index) => {
  let label = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  return label;
};
const content = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(content).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return typeof value === 'string' && value.startsWith('=') ? `'${value}` : value;
};
const first = (row, ...keys) => keys.map((key) => row[key]).find((value) => value !== undefined && value !== null) ?? '';
const hyperlinks = [];
const addLink = (sheet, cell, url, label) => {
  if (typeof url !== 'string' || !(/^https?:\/\//i.test(url) || /^[a-z0-9_./-]+\.md(?:#[a-z0-9_-]+)?$/i.test(url))) return;
  sheet.getRange(cell).values = [[label]];
  hyperlinks.push({ sheet: sheet.name, cell, url });
};

function base(sheet, lastColumn, lastRow) {
  sheet.showGridLines = false;
  sheet.getRange(`A1:${lastColumn}${lastRow}`).format = {
    font: { name: 'Arial', size: 10, color: colors.ink },
    verticalAlignment: 'center',
    rowHeight: 24,
  };
}

function opening(sheet, title, subtitle, lastColumn) {
  sheet.getRange('A1').format.rowHeight = 9;
  sheet.getRange('A2').values = [[title]];
  sheet.getRange('A2').format.font = { name: 'Arial', size: 14, bold: true, color: colors.header };
  sheet.getRange('A2').format.rowHeight = 25;
  sheet.getRange(`A2:${lastColumn}2`).format.borders = { bottom: { style: 'thin', color: colors.line } };
  sheet.getRange('A3').values = [[subtitle]];
  sheet.getRange('A3').format.font = { name: 'Arial', size: 10, color: colors.muted };
  sheet.getRange('A3').format.rowHeight = 23;
  sheet.getRange('A4').format.rowHeight = 8;
}

function table(sheet, name, title, subtitle, columns, data, minHeight = 42) {
  const end = columnLetter(columns.length - 1);
  const last = data.length + 5;
  base(sheet, end, Math.max(last, 6));
  opening(sheet, title, subtitle, end);
  sheet.getRange(`A5:${end}5`).values = [columns.map((col) => col.label)];
  if (data.length) {
    sheet.getRange(`A6:${end}${last}`).values = data.map((row) => columns.map((col) => content(col.value(row))));
    sheet.getRange(`A6:${end}${last}`).format.wrapText = true;
    sheet.getRange(`A6:${end}${last}`).format.verticalAlignment = 'top';
    sheet.getRange(`A6:${end}${last}`).format.rowHeight = minHeight;
    sheet.getRange(`A6:${end}${last}`).format.fill = '#FFFFFF';
  }
  const nativeTable = sheet.tables.add(`A5:${end}${last}`, true, name);
  nativeTable.style = 'TableStyleLight1';
  nativeTable.showFilterButton = true;
  for (let i = 0; i < columns.length; i++) {
    const letter = columnLetter(i);
    sheet.getRange(`${letter}5:${letter}${Math.max(last, 6)}`).format.columnWidth = columns[i].width;
    if (columns[i].link && data.length) {
      for (let j = 0; j < data.length; j++) {
        addLink(sheet, `${letter}${j + 6}`, columns[i].value(data[j]), columns[i].link);
      }
      sheet.getRange(`${letter}6:${letter}${last}`).format.font.color = colors.blue;
    }
    if (columns[i].numberFormat && data.length) sheet.getRange(`${letter}6:${letter}${last}`).setNumberFormat(columns[i].numberFormat);
  }
  sheet.getRange(`A5:${end}5`).format = {
    fill: colors.header,
    font: { name: 'Arial', size: 10, color: '#FFFFFF', bold: true },
    wrapText: true,
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    rowHeight: 33,
    borders: { insideVertical: { style: 'thin', color: '#FFFFFF' } },
  };
  sheet.freezePanes.freezeRows(5);
  sheet.freezePanes.freezeColumns(2);
  if (data.length) {
    // Size each data row to its longest wrapped field, preserving full text.
    for (let j = 0; j < data.length; j++) {
      const lines = columns.map((col) => {
        const rawValue = col.value(data[j]);
        const value = col.link ? col.link : rawValue instanceof Date ? '09/28/26' : String(content(rawValue) ?? '');
        return value.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(8, col.width - 3))), 0);
      });
      sheet.getRange(`A${j + 6}:${end}${j + 6}`).format.rowHeight = Math.max(minHeight, Math.max(...lines) * 13 + 10);
      if (j % 2 === 0) sheet.getRange(`A${j + 6}:${end}${j + 6}`).format.fill = colors.light;
    }
  }
  return { end, last };
}

const backlogColumns = [
  { label: 'Priority', width: 11, value: (r) => r.priority },
  { label: 'Item', width: 30, value: (r) => first(r, 'item', 'name', 'connector') },
  { label: 'Status', width: 20, value: (r) => r.status },
  { label: 'Lane', width: 18, value: (r) => r.lane },
  { label: 'Change', width: 21, value: (r) => first(r, 'change', 'type', 'action') },
  { label: 'Bucket', width: 27, value: (r) => first(r, 'bucket', 'category') },
  { label: 'Why and scope', width: 64, value: (r) => first(r, 'rationale', 'why', 'scope') },
  { label: 'Effort', width: 17, value: (r) => r.effort },
  { label: 'Dependency or next step', width: 62, value: (r) => first(r, 'next_step', 'dependency', 'dependencies') },
  { label: 'Evidence', width: 15, value: (r) => first(r, 'evidence_url', 'source_url', 'listing_url'), link: 'Open source' },
  { label: 'ID', width: 12, value: (r) => r.id },
];
const backlogData = [...audit.backlog].sort((a, b) => String(a.priority).localeCompare(String(b.priority)) || (a.order ?? 0) - (b.order ?? 0));
const backlogRange = table(backlogSheet, 'ConnectorBacklog', 'Connector implementation backlog', 'Priorities are product judgments. Filter by change, bucket, or effort to plan the next batch.', backlogColumns, backlogData, 55);
if (backlogData.length) {
  const priorities = backlogSheet.getRange(`A6:A${backlogRange.last}`);
  priorities.conditionalFormats.add('beginsWith', { text: 'P0', format: { fill: colors.urgent, font: { bold: true } } });
  priorities.conditionalFormats.add('beginsWith', { text: 'P1', format: { fill: colors.amber, font: { bold: true } } });
  priorities.conditionalFormats.add('beginsWith', { text: 'P2', format: { fill: colors.green } });
}

const inventoryColumns = [
  { label: 'Connector', width: 31, value: (r) => first(r, 'name', 'title') },
  { label: 'Type', width: 11, value: (r) => r.directory_type },
  { label: 'External MCP', width: 27, value: (r) => r.external_mcp },
  { label: 'Bucket', width: 28, value: (r) => first(r, 'bucket', 'product_bucket') },
  { label: 'Priority', width: 11, value: (r) => r.priority },
  { label: 'Recommendation', width: 28, value: (r) => r.recommendation },
  { label: 'Product fit', width: 19, value: (r) => first(r, 'product_fit', 'fit') },
  { label: 'Auth', width: 23, value: (r) => first(r, 'auth', 'auth_model') },
  { label: 'Validation and blockers', width: 59, value: (r) => [first(r, 'validation', 'verification'), first(r, 'blocker', 'blockers')].filter(Boolean).join('\n') },
  { label: 'Current support', width: 28, value: (r) => first(r, 'current_support', 'existing_support') },
  { label: 'Rationale', width: 62, value: (r) => first(r, 'rationale', 'notes') },
  { label: 'Next step', width: 62, value: (r) => r.next_step },
  { label: 'Evidence level', width: 27, value: (r) => r.evidence_level },
  { label: 'Official categories', width: 31, value: (r) => r.directory_categories },
  { label: 'Bucket basis', width: 18, value: (r) => r.bucket_source },
  { label: 'Publisher', width: 29, value: (r) => r.publisher },
  { label: 'Server URL', width: 65, value: (r) => r.server_url },
  { label: 'Vendor endpoint(s)', width: 65, value: (r) => first(r, 'recommended_endpoint', 'recommended_endpoints') },
  { label: 'Directory evidence', width: 17, value: (r) => r.listing_url, link: 'Claude listing' },
  { label: 'Vendor evidence', width: 17, value: (r) => first(r, 'vendor_evidence_url', 'vendor_url'), link: 'Vendor source' },
  { label: 'Interactive app', width: 15, value: (r) => r.interactive_app === undefined ? '' : r.interactive_app ? 'Yes' : 'No' },
  { label: 'Works with', width: 34, value: (r) => r.works_with },
  { label: 'Verified tier', width: 16, value: (r) => r.verified_tier },
  { label: 'Added', width: 13, value: (r) => r.added_at ? new Date(r.added_at) : '', numberFormat: 'mm/dd/yy' },
  { label: 'Slug', width: 46, value: (r) => r.slug },
];
const inventoryData = [...audit.rows].sort((a, b) => String(first(a, 'name', 'title')).localeCompare(String(first(b, 'name', 'title'))) || a.slug.localeCompare(b.slug));
const inventoryRange = table(inventorySheet, 'ClaudeConnectorInventory', 'Claude connector directory audit', 'Complete directory snapshot. Remote endpoints are advertised addresses, not proof of OAuth compatibility or tested access.', inventoryColumns, inventoryData, 42);
inventorySheet.getRange(`B6:B${inventoryRange.last}`).conditionalFormats.add('containsText', { text: 'remote', format: { fill: '#E7EFF7' } });
inventorySheet.getRange(`B6:B${inventoryRange.last}`).conditionalFormats.add('containsText', { text: 'local', format: { fill: colors.purple } });
inventorySheet.getRange(`E6:E${inventoryRange.last}`).conditionalFormats.add('beginsWith', { text: 'P0', format: { fill: colors.urgent, font: { bold: true } } });
inventorySheet.getRange(`E6:E${inventoryRange.last}`).conditionalFormats.add('beginsWith', { text: 'P1', format: { fill: colors.amber, font: { bold: true } } });

base(methodSheet, 'C', 60);
opening(methodSheet, 'Method and legend', 'Snapshot scope, interpretation, and evidence.', 'C');
methodSheet.getRange('A1:A60').format.columnWidth = 33;
methodSheet.getRange('B1:B60').format.columnWidth = 18;
methodSheet.getRange('C1:C60').format.columnWidth = 102;
methodSheet.getRange('A5:C5').values = [['Scope', 'Records', 'Meaning']];
methodSheet.getRange('A6:C10').values = [
  ['All connector listings', null, 'One row per unique directory listing slug.'],
  ['Remote listings', null, 'Hosted connector listings. Some omit a public server URL.'],
  ['Local listings', null, 'Local or desktop listings. A hosted implementation needs separate verification.'],
  ['Published server URLs', null, 'Endpoint metadata from the directory, without credentialed execution tests.'],
  ['Backlog items', null, 'Curated implementation work. This is not a count of ready-to-add connectors.'],
];
methodSheet.getRange('B6:B10').formulas = [
  [`=COUNTA('All connectors'!A6:A${inventoryRange.last})`],
  [`=COUNTIFS('All connectors'!B6:B${inventoryRange.last},"remote")`],
  [`=COUNTIFS('All connectors'!B6:B${inventoryRange.last},"local")`],
  [`=COUNTA('All connectors'!Q6:Q${inventoryRange.last})`],
  [backlogData.length ? `=COUNTA('Backlog'!B6:B${backlogRange.last})` : '=0'],
];
methodSheet.getRange('B6:B10').setNumberFormat('#,##0');
methodSheet.getRange('B6:B10').format.horizontalAlignment = 'right';
const summary = audit.summary ?? {};
const capturedAt = first(summary, 'captured_at', 'captured_at_utc', 'capture_time', 'as_of', 'snapshot_at');
const notes = [
  ['Captured', capturedAt || 'See the capture manifest accompanying this audit.'],
  ['Coverage', 'The live page dataset and sitemap contain the same 861 unique connector slugs. Featured, trending, and new sections are subsets.'],
  ['Distinct listings', 'Local and remote listings with the same product name remain separate. Plugins are outside this connector inventory.'],
  ['Product buckets', 'Official directory categories are preserved. Inferred buckets are analysis and do not replace missing official tags.'],
  ['Validation limit', 'Directory publication does not prove that a connector accepts this app, supports dynamic OAuth registration, or exposes the same tools without vendor setup.'],
  ['Endpoint and auth', 'A server URL is a starting point. Verify provider ownership, authentication, client registration, plan limits, scopes, and callback support before shipping.'],
  ['Local connectors', 'Local listings are not drop-in hosted connectors. Review installation, runtime dependencies, credentials, and platform support.'],
  ['Priorities', 'See backlog rationale and next steps. Priority is a product judgment, not a directory endorsement.'],
  ['Refresh', 'Recapture the directory and sitemap, regenerate the normalized audit, then rebuild this workbook. Recheck authentication and endpoint evidence before implementation.'],
];
for (const key of ['priority_definitions', 'effort_definitions', 'evidence_definitions']) {
  if (summary[key] && typeof summary[key] === 'object' && !Array.isArray(summary[key])) {
    for (const [label, detail] of Object.entries(summary[key])) notes.push([label, content(detail)]);
  }
}
if (summary.limitations) for (const [index, value] of (Array.isArray(summary.limitations) ? summary.limitations : [summary.limitations]).entries()) notes.push([`Audit limit ${index + 1}`, content(value)]);
if (summary.effort_definition) notes.push(['Effort', summary.effort_definition]);
methodSheet.getRange('A13:C13').values = [['Interpretation', '', 'Detail']];
for (let i = 0; i < notes.length; i++) {
  const row = i + 14;
  methodSheet.getRange(`A${row}`).values = [[notes[i][0]]];
  methodSheet.getRange(`C${row}`).values = [[content(notes[i][1])]];
  methodSheet.getRange(`C${row}`).format.wrapText = true;
  methodSheet.getRange(`A${row}:C${row}`).format.rowHeight = Math.max(31, Math.ceil(String(notes[i][1]).length / 100) * 14 + 11);
}
if (capturedAt && !Number.isNaN(new Date(capturedAt).getTime())) {
  methodSheet.getRange('A14').values = [['Captured (UTC)']];
  methodSheet.getRange('C14').values = [[new Date(capturedAt)]];
  methodSheet.getRange('C14').setNumberFormat('yyyy-mm-dd hh:mm');
  methodSheet.getRange('C14').format.horizontalAlignment = 'left';
}
const sourceRow = 15 + notes.length;
methodSheet.getRange(`A${sourceRow}:C${sourceRow}`).values = [['Evidence', 'Source', 'Location']];
const sources = [
  ['Directory', 'Claude', 'https://claude.com/marketplace/connectors-plugins'],
  ['Sitemap', 'Claude', 'https://claude.com/sitemap.xml'],
];
for (let i = 0; i < sources.length; i++) {
  const row = sourceRow + i + 1;
  methodSheet.getRange(`A${row}:C${row}`).values = [sources[i]];
  addLink(methodSheet, `C${row}`, sources[i][2], sources[i][2]);
  methodSheet.getRange(`C${row}`).format.font.color = colors.blue;
}
for (const row of [5, 13, sourceRow]) methodSheet.getRange(`A${row}:C${row}`).format = {
  fill: colors.header,
  font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' },
  rowHeight: 27,
};
methodSheet.getRange('C6:C10').format.wrapText = true;
methodSheet.getRange('A6:C10').format.rowHeight = 34;
methodSheet.getRange('A14:C60').format.verticalAlignment = 'center';

workbook.recalculate();
const inspections = [];
for (const [sheet, range] of [['Backlog', 'A5:H9'], ['All connectors', 'A5:F10'], ['Method and legend', 'A5:C10']]) {
  const result = await workbook.inspect({ kind: 'table', range: `${sheet}!${range}`, include: 'values,formulas', tableMaxRows: 7, tableMaxCols: 8, maxChars: 7000 });
  inspections.push(result.ndjson);
}
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 30 }, summary: 'Final formula error scan', maxChars: 6000 });
inspections.push(errors.ndjson);
await fs.writeFile(path.join(runtimeDir, 'verification.ndjson'), inspections.join('\n'));
for (const [sheetName, range, filename] of [
  ['Backlog', 'A1:F10', 'backlog.png'],
  ['All connectors', 'A1:F12', 'inventory.png'],
  ['Method and legend', `A1:C${sourceRow + 2}`, 'method.png'],
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1.5, format: 'png' });
  await fs.writeFile(path.join(runtimeDir, filename), new Uint8Array(await preview.arrayBuffer()));
}
if (!prototype) {
  const todoistRow = inventoryData.findIndex((row) => row.slug === 'todoist') + 6;
  for (const [range, filename] of [
    [`G${todoistRow}:M${todoistRow + 1}`, 'inventory-todoist-details.png'],
    ['G5:K9', 'backlog-details.png'],
  ]) {
    const sheetName = filename.startsWith('backlog') ? 'Backlog' : 'All connectors';
    const preview = await workbook.render({ sheetName, range, scale: 1.5, format: 'png' });
    await fs.writeFile(path.join(runtimeDir, filename), new Uint8Array(await preview.arrayBuffer()));
  }
}
if (!previewOnly && !prototype) {
  const output = await SpreadsheetFile.exportXlsx(workbook);
  const outputPath = path.join(auditDir, 'claude-connectors-audit.xlsx');
  await output.save(outputPath);
  try {
    await fs.rename(`${outputPath}.inspect.ndjson`, path.join(runtimeDir, 'export-inspection.ndjson'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Artifact Tool does not implement HYPERLINK calculation or a native link
  // setter. Add only standard external hyperlink relationships after export.
  const linksPath = path.join(runtimeDir, 'hyperlinks.json');
  await fs.writeFile(linksPath, JSON.stringify(hyperlinks));
  execFileSync('python3', ['-c', String.raw`
import json, os, sys, tempfile, zipfile
from collections import defaultdict
from xml.etree import ElementTree as E
book, links_path = sys.argv[1:]
ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
pkg = 'http://schemas.openxmlformats.org/package/2006/relationships'
E.register_namespace('', ns)
E.register_namespace('r', rel)
with zipfile.ZipFile(book) as z:
    parts = {entry.filename: z.read(entry.filename) for entry in z.infolist()}
    infos = z.infolist()
workbook_xml = E.fromstring(parts['xl/workbook.xml'])
relationship_xml = E.fromstring(parts['xl/_rels/workbook.xml.rels'])
targets = {node.attrib['Id']: node.attrib['Target'] for node in relationship_xml}
sheet_paths = {}
for sheet in workbook_xml.find('{%s}sheets' % ns):
    target = targets[sheet.attrib['{%s}id' % rel]]
    sheet_paths[sheet.attrib['name']] = target.lstrip('/') if target.startswith('/') else 'xl/' + target
grouped = defaultdict(list)
for link in json.load(open(links_path)):
    grouped[link['sheet']].append(link)
for name, links in grouped.items():
    sheet_path = sheet_paths[name]
    root = E.fromstring(parts[sheet_path])
    link_nodes = E.Element('{%s}hyperlinks' % ns)
    rel_path = os.path.dirname(sheet_path) + '/_rels/' + os.path.basename(sheet_path) + '.rels'
    relationships = E.fromstring(parts[rel_path]) if rel_path in parts else E.Element('{%s}Relationships' % pkg)
    existing_ids = {node.attrib['Id'] for node in relationships}
    for index, link in enumerate(links, 1):
        relationship_id = 'rIdAuditLink' + str(index)
        if relationship_id in existing_ids:
            raise ValueError('Unexpected existing audit hyperlink relationship')
        E.SubElement(link_nodes, '{%s}hyperlink' % ns, {'ref': link['cell'], '{%s}id' % rel: relationship_id})
        E.SubElement(relationships, '{%s}Relationship' % pkg, {'Id': relationship_id, 'Type': rel + '/hyperlink', 'Target': link['url'], 'TargetMode': 'External'})
    # Hyperlinks follow validations and precede print/drawing/table metadata.
    later = {'printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','customProperties','cellWatches','ignoredErrors','smartTags','drawing','legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst'}
    index = next((i for i, node in enumerate(root) if node.tag.split('}')[-1] in later), len(root))
    root.insert(index, link_nodes)
    parts[sheet_path] = E.tostring(root, encoding='utf-8', xml_declaration=True)
    parts[rel_path] = E.tostring(relationships, encoding='utf-8', xml_declaration=True)
fd, temporary = tempfile.mkstemp(suffix='.xlsx', dir=os.path.dirname(book))
os.close(fd)
with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as z:
    for filename, data in parts.items():
        z.writestr(filename, data)
os.replace(temporary, book)
`, outputPath, linksPath], { stdio: 'inherit' });
}
console.log(JSON.stringify({ rows: audit.rows.length, backlog: audit.backlog.length, prototype, previewOnly, previews: runtimeDir, summary: methodSheet.getRange('B6:B10').values, errors: errors.ndjson }, null, 2));
