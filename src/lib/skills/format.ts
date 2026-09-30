/**
 * SKILL.md, read and written without losing anything.
 *
 * A skill is a folder whose SKILL.md opens with YAML frontmatter (`name`,
 * `description`, and whatever else the author put there: `license`,
 * `allowed-tools`, a harness's own keys) followed by a markdown body. The
 * format is the open Agent Skills spec (agentskills.io/specification), which
 * every harness Ri runs reads.
 *
 * The builder edits `name`, `description` and the body as fields, so this
 * module splits a file into those parts and puts it back together. Two rules
 * keep a round trip honest:
 *
 *   - The body is bytes. Whatever follows the closing fence is kept verbatim
 *     and replaced verbatim.
 *   - The frontmatter is only re-serialized when `name` or `description`
 *     actually changes, and then through the `yaml` Document API, which keeps
 *     key order, comments and scalar styles. Untouched frontmatter stays
 *     byte-exact.
 */

import { Document, isMap, isScalar, parseDocument, type Pair } from 'yaml';

export const SKILL_FILE = 'SKILL.md';
export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;
export const COMPATIBILITY_MAX = 500;
/** The spec's advice for SKILL.md length. Past it is a warning, never a block. */
export const BODY_LINES_SOFT_MAX = 500;

export interface ParsedSkillFile {
  /** Frontmatter `name`, or null when missing or not a string. */
  name: string | null;
  /** Frontmatter `description`, or null when missing or not a string. */
  description: string | null;
  /** Everything after the closing fence, verbatim. */
  body: string;
  /** The other frontmatter keys, in file order. */
  otherKeys: string[];
  /** Frontmatter `compatibility`, for its length check. */
  compatibility: string | null;
  /**
   * Why the frontmatter can't be edited as fields (missing, unterminated,
   * invalid YAML, not a mapping). Null when it can.
   */
  frontmatterError: string | null;
}

interface Split {
  /** The YAML between the fences, or null when there is no frontmatter block. */
  frontmatter: string | null;
  /** The opening fence line through the closing fence line, newline included. */
  head: string;
  body: string;
  error: string | null;
}

const OPEN_FENCE = /^﻿?---[ \t]*\r?\n/;
const CLOSE_FENCE = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m;

function split(text: string): Split {
  const open = OPEN_FENCE.exec(text);
  if (!open) {
    return { frontmatter: null, head: '', body: text, error: 'The file has no frontmatter. It should start with a --- line.' };
  }
  const rest = text.slice(open[0].length);
  const close = CLOSE_FENCE.exec(rest);
  if (!close) {
    return { frontmatter: null, head: '', body: text, error: 'The frontmatter never closes. Add a --- line after it.' };
  }
  const frontmatter = rest.slice(0, close.index);
  const headLength = open[0].length + close.index + close[0].length;
  return { frontmatter, head: text.slice(0, headLength), body: text.slice(headLength), error: null };
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function parseSkillFile(text: string): ParsedSkillFile {
  const parts = split(text);
  const empty = { name: null, description: null, otherKeys: [], compatibility: null };
  if (parts.frontmatter === null) {
    return { ...empty, body: parts.body, frontmatterError: parts.error };
  }
  const doc = parseDocument(parts.frontmatter);
  if (doc.errors.length > 0) {
    return { ...empty, body: parts.body, frontmatterError: `The frontmatter isn't valid YAML: ${doc.errors[0].message.split('\n')[0]}` };
  }
  const data: unknown = doc.toJS();
  if (data === null || data === undefined) {
    return { ...empty, body: parts.body, frontmatterError: null };
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    return { ...empty, body: parts.body, frontmatterError: 'The frontmatter should be a list of key: value lines.' };
  }
  const record = data as Record<string, unknown>;
  return {
    name: stringField(record.name),
    description: stringField(record.description),
    body: parts.body,
    otherKeys: Object.keys(record).filter((key) => key !== 'name' && key !== 'description'),
    compatibility: stringField(record.compatibility),
    frontmatterError: null,
  };
}

export interface SkillFields {
  name?: string;
  description?: string;
  body?: string;
}

/** Normalize line endings so a body pasted from anywhere lands as the file's own. */
function eol(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Write fields into a SKILL.md. With `previous`, everything not named in
 * `fields` is kept, and the frontmatter bytes only change when `name` or
 * `description` does. Without it (or when the old frontmatter can't be read
 * as fields), a fresh file is written from the fields.
 */
export function renderSkillFile(previous: string | null, fields: SkillFields): string {
  const parts = previous === null ? null : split(previous);
  const parsed = previous === null ? null : parseSkillFile(previous);
  const usable = parts !== null && parsed !== null && parts.frontmatter !== null && parsed.frontmatterError === null;

  const body = fields.body ?? parts?.body ?? '';
  if (!usable) {
    const name = fields.name ?? parsed?.name ?? '';
    const description = fields.description ?? parsed?.description ?? '';
    return `${freshFrontmatter(name, description)}${body}`;
  }

  const nameChanged = fields.name !== undefined && fields.name !== parsed.name;
  const descriptionChanged = fields.description !== undefined && fields.description !== parsed.description;
  if (!nameChanged && !descriptionChanged) return `${parts.head}${body}`;

  const doc = parseDocument(parts.frontmatter!);
  if (nameChanged) setFirst(doc, 'name', fields.name!);
  if (descriptionChanged) setAfterName(doc, fields.description!);
  const newline = eol(parts.head);
  let yamlText = doc.toString({ lineWidth: 0 });
  if (newline === '\r\n') yamlText = yamlText.replace(/\r?\n/g, '\r\n');
  return `---${newline}${yamlText}---${newline}${body}`;
}

type YamlDoc = ReturnType<typeof parseDocument>;

function isKey(pair: Pair, key: string): boolean {
  return isScalar(pair.key) ? pair.key.value === key : pair.key === key;
}

/** Set a key, adding it at the top when it isn't there (name leads by convention). */
function setFirst(doc: YamlDoc, key: string, value: string) {
  if (doc.has(key) || !isMap(doc.contents)) {
    doc.set(key, value);
    return;
  }
  doc.contents.items.unshift(doc.createPair(key, value));
}

/** Set `description`, adding it right after `name` when it isn't there. */
function setAfterName(doc: YamlDoc, value: string) {
  if (doc.has('description') || !isMap(doc.contents)) {
    doc.set('description', value);
    return;
  }
  const items = doc.contents.items as Pair[];
  const nameIndex = items.findIndex((pair) => isKey(pair, 'name'));
  items.splice(nameIndex + 1, 0, doc.createPair('description', value));
}

function freshFrontmatter(name: string, description: string): string {
  return `---\n${new Document({ name, description }).toString({ lineWidth: 0 })}---\n`;
}

// ─── Validation ───────────────────────────────────────────────

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Why a name breaks the Agent Skills rules, or null when it's fine. */
export function nameProblem(name: string): string | null {
  if (!name) return 'Give it a name.';
  if (name.length > NAME_MAX) return `Keep the name to ${NAME_MAX} characters or fewer.`;
  if (!NAME_PATTERN.test(name)) {
    return 'Use lowercase letters, numbers and single hyphens, like review-pull-requests.';
  }
  return null;
}

export function isValidSkillName(name: string): boolean {
  return nameProblem(name) === null;
}

export interface SkillProblem {
  field: 'name' | 'description' | 'frontmatter' | 'body' | 'compatibility';
  level: 'error' | 'warning';
  message: string;
}

/**
 * Everything wrong with a skill, as the builder shows it. Errors keep a
 * skill from being turned on; warnings are advice.
 */
export function checkSkill(parsed: ParsedSkillFile, folderName: string): SkillProblem[] {
  const problems: SkillProblem[] = [];
  if (parsed.frontmatterError) {
    problems.push({ field: 'frontmatter', level: 'error', message: parsed.frontmatterError });
    return problems;
  }
  const name = parsed.name ?? '';
  const badName = nameProblem(name);
  if (badName) problems.push({ field: 'name', level: 'error', message: badName });
  else if (name !== folderName) {
    problems.push({
      field: 'name',
      level: 'error',
      message: `The file says name: ${name}, but the folder is ${folderName}. They have to match.`,
    });
  }
  const description = (parsed.description ?? '').trim();
  if (!description) {
    problems.push({
      field: 'description',
      level: 'error',
      message: 'Say what it does and when to use it. Agents read this to decide when to reach for the skill.',
    });
  } else if (description.length > DESCRIPTION_MAX) {
    problems.push({
      field: 'description',
      level: 'error',
      message: `Keep the description to ${DESCRIPTION_MAX.toLocaleString('en-US')} characters. It's ${description.length.toLocaleString('en-US')} now.`,
    });
  }
  if (parsed.compatibility !== null && parsed.compatibility.length > COMPATIBILITY_MAX) {
    problems.push({
      field: 'compatibility',
      level: 'error',
      message: `Keep compatibility to ${COMPATIBILITY_MAX} characters.`,
    });
  }
  if (!parsed.body.trim()) {
    problems.push({ field: 'body', level: 'warning', message: 'The instructions are empty.' });
  } else if (lineCount(parsed.body) > BODY_LINES_SOFT_MAX) {
    problems.push({
      field: 'body',
      level: 'warning',
      message: `Over ${BODY_LINES_SOFT_MAX} lines. Agents load all of it each time, so move detail into files under references/.`,
    });
  }
  return problems;
}

function lineCount(text: string): number {
  return text.split('\n').length;
}

// ─── Names from intent ────────────────────────────────────────

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'to', 'for', 'of', 'in', 'on', 'with', 'my', 'me', 'i', 'we', 'our',
  'you', 'your', 'when', 'that', 'this', 'it', 'its', 'is', 'are', 'be', 'from', 'into', 'about', 'by', 'at',
  'as', 'so', 'if', 'then', 'help', 'helps', 'skill', 'should', 'can', 'could', 'would', 'will', 'do',
  'does', 'use', 'using', 'please', 'want', 'need', 'make', 'every', 'each', 'any', 'all', 'some',
  'what', 'how', 'why', 'who', 'where', 'which', 'up', 'out', 'them', 'they', 'something', 'things',
]);

/**
 * A first name for a skill from what the user said it should do: the first
 * few meaningful words, as a valid slug. The user (or the AI, while it's a
 * draft) renames it freely, so this only has to be a sensible start.
 */
export function suggestSkillName(intent: string, taken: ReadonlySet<string> = new Set()): string {
  const words = intent
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !STOPWORDS.has(word));
  let base = '';
  for (const word of words.slice(0, 4)) {
    const next = base ? `${base}-${word}` : word;
    if (next.length > NAME_MAX - 3) break;
    base = next;
  }
  if (!base) base = 'new-skill';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
