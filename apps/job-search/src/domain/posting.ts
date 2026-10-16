/**
 * Fields read from a saved job description, each with the exact passage it
 * came from. Unknown values stay unknown. Requirements are the bullet lines
 * under the posting's own requirement headings, quoted as written.
 */
import { parseCompensation } from './compensation.js';
import { stableHash } from './hash.js';
import type { PostingExtract, Requirement } from './model.js';
import { cleanTitle, extractRequisitionIds } from './text.js';

const HEADING = /^(?:#{1,4}\s*)?(?:\*\*)?\s*(requirements?|qualifications?|minimum qualifications|basic qualifications|preferred qualifications|nice to haves?|what you(?:'|’)ll (?:do|bring|need|work on)|what we(?:'|’)re looking for|what you bring|who you are|about you|you (?:have|bring|will|might be a fit)|responsibilities|key responsibilities|in this role(?: you will)?|the role|your role|skills(?: and experience)?|experience|must haves?|you(?:'|’)ll thrive if|we(?:'|’)d love to see)\b[^\n]{0,40}?:?\s*(?:\*\*)?\s*$/i;
const OTHER_HEADING = /^(?:#{1,4}\s*)?(?:\*\*)?\s*(about (?:us|the company|the team)|benefits|perks|compensation|salary|pay|how to apply|equal opportunity|eeo|our values|why join|what we offer|location|the team)\b[^\n]{0,40}?:?\s*(?:\*\*)?\s*$/i;
const BULLET = /^\s*(?:[-*•·▪◦‣–]|\d{1,2}[.)])\s+(.{6,})$/;

function requirementsOf(lines: string[]): Requirement[] {
  const found: Requirement[] = [];
  let section: string | null = null;
  let inRequirements = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (HEADING.test(trimmed) && trimmed.length < 70 && !BULLET.test(trimmed)) {
      section = cleanTitle(trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/:$/, ''));
      inRequirements = true;
      continue;
    }
    if (OTHER_HEADING.test(trimmed) && trimmed.length < 70 && !BULLET.test(trimmed)) {
      inRequirements = false;
      section = null;
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet && inRequirements) {
      const text = bullet[1].replace(/\*\*/g, '').trim();
      found.push({ id: stableHash(`${section}|${trimmed}`).slice(0, 12), text: text.slice(0, 400), passage: trimmed.slice(0, 600), section: section?.slice(0, 120) ?? null });
      if (found.length >= 40) break;
    }
  }
  if (found.length) return found;
  // No headed sections: fall back to bullets anywhere, which most postings use for requirements.
  for (const raw of lines) {
    const bullet = BULLET.exec(raw.trimEnd());
    if (!bullet) continue;
    const trimmed = raw.trim();
    found.push({ id: stableHash(`|${trimmed}`).slice(0, 12), text: bullet[1].trim().slice(0, 400), passage: trimmed.slice(0, 600), section: null });
    if (found.length >= 30) break;
  }
  return found;
}

const LABELLED = (label: string) => new RegExp(`^\\s*(?:\\*\\*)?(?:${label})(?:\\*\\*)?\\s*[:|-]\\s*(.{2,120})$`, 'im');
function labelled(text: string, label: string) {
  const match = LABELLED(label).exec(text);
  return match ? { value: cleanTitle(match[1].replace(/\*\*/g, '')), passage: match[0].trim() } : null;
}

export function extractPosting(text: string): PostingExtract {
  const clean = text.replace(/\r\n?/g, '\n');
  const lines = clean.split('\n');
  const head = lines.slice(0, 12).map((line) => line.trim()).filter(Boolean);

  let role = labelled(clean, 'job title|title|role|position');
  if (!role) {
    const first = head.find((line) => line.length <= 80 && !/[.!?]$/.test(line) && !/^(about|job description|description)\b/i.test(line));
    if (first) {
      const at = /^(.{3,70}?)\s+(?:at|@|-|–|\|)\s+([A-Z][\w&.' -]{1,60})$/.exec(first);
      role = { value: cleanTitle(at ? at[1] : first), passage: first };
    }
  }
  let company = labelled(clean, 'company|organization|employer');
  if (!company) {
    for (const line of head) {
      const at = /^.{3,70}?\s+(?:at|@|-|–|\|)\s+([A-Z][\w&.' -]{1,60})$/.exec(line);
      if (at) { company = { value: cleanTitle(at[1]), passage: line }; break; }
    }
  }
  if (!company) {
    const about = /^(?:#{1,4}\s*)?about ([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,3})\s*:?\s*$/m.exec(clean) ?? /\b([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,2}) is (?:hiring|looking for|seeking)\b/.exec(clean) ?? /\bjoin ([A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*){0,2})(?: as|\b)/.exec(clean);
    if (about && !/^(?:the|our|us|you|this)$/i.test(about[1])) company = { value: cleanTitle(about[1]), passage: about[0].trim() };
  }
  const location = labelled(clean, 'location|locations|based in|office');
  const arrangementMatch = /\b(fully remote|remote[- ]first|remote|hybrid|on[- ]?site|in[- ]office)\b/i.exec(clean);
  const arrangement = arrangementMatch
    ? {
        value: /hybrid/i.test(arrangementMatch[1]) ? ('hybrid' as const) : /remote/i.test(arrangementMatch[1]) ? ('remote' as const) : ('onsite' as const),
        passage: clean.slice(Math.max(0, clean.lastIndexOf('\n', arrangementMatch.index) + 1), Math.max(clean.indexOf('\n', arrangementMatch.index), arrangementMatch.index + arrangementMatch[0].length)).trim().slice(0, 400),
      }
    : null;
  const requisition = labelled(clean, 'req(?:uisition)? ?(?:id|#|number)|job ?(?:id|#|number)|reference');
  const reqId = requisition ? extractRequisitionIds(requisition.passage)[0] ?? (/\d{3,}/.test(requisition.value) ? requisition.value.toUpperCase() : null) : extractRequisitionIds(clean)[0] ?? null;
  return {
    company: company ? { value: company.value.slice(0, 300), passage: company.passage.slice(0, 400) } : null,
    role: role && role.value ? { value: role.value.slice(0, 300), passage: role.passage.slice(0, 400) } : null,
    location: location ? { value: location.value.slice(0, 300), passage: location.passage.slice(0, 400) } : null,
    workArrangement: arrangement,
    requisitionId: reqId ? { value: reqId, passage: (requisition?.passage ?? reqId).slice(0, 400) } : null,
    compensation: parseCompensation(clean, 'posting'),
    requirements: requirementsOf(lines),
  };
}
