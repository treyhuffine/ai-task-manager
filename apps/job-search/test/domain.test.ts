import { describe, it, expect } from 'vitest';
import { classifyMessage, extractCompanies, extractRoleTitles, looksJobRelated, parseStatedTime } from '../src/domain/classify.js';
import { matchOpportunity, type MatchSubject, type OpportunityIdentity } from '../src/domain/match.js';
import { compareCompensation, formatCompensation, parseCompensation, toMinorUnits } from '../src/domain/compensation.js';
import { extractPosting } from '../src/domain/posting.js';
import { diffLines } from '../src/domain/diff.js';
import { boundedSources, buildPreparationPrompt, unsupportedClaims, validatePreparationReply, type PrepSource } from '../src/domain/prep-ai.js';
import { cleanTitle, companyKey, extractRequisitionIds, urlKey } from '../src/domain/text.js';

const say = (subject: string, text = '', sent = false) => classifyMessage({ subject, text, sent }).classification;

describe('mail classification', () => {
  it('reads acknowledgments, invitations to choose times, confirmations, reschedules, cancellations, offers and rejections from explicit wording', () => {
    expect(say('Thank you for applying to Lumen', 'We have received your application for the Staff designer role.')).toBe('acknowledgment');
    expect(say('Next steps', 'Could you share your availability for a 45 minute call next week?')).toBe('scheduling');
    expect(say('Next steps', 'Please pick a time that works: https://calendly.com/fictional/30min')).toBe('scheduling');
    expect(say('Re: Portfolio', 'We look forward to discussing your portfolio on Friday, October 16 at 10:00 MDT.')).toBe('interview_confirmed');
    expect(say('Change of plans', 'We need to reschedule our interview to next week.')).toBe('reschedule');
    expect(say('Interview canceled', 'Unfortunately we have to cancel the interview on Friday.')).toBe('cancellation');
    expect(say('Your offer', 'We are delighted to extend an offer for the Design lead role.')).toBe('offer');
    expect(say('Your application', 'We have decided to move forward with other candidates.')).toBe('rejection');
    expect(say('Update', 'The position has been filled.')).toBe('rejection');
    expect(say('Application for Product designer', 'Attached is my résumé for the role.', true)).toBe('sent_application');
    expect(say('Opportunity', 'I am reaching out about a design role at our client.')).toBe('recruiter');
    expect(say('Weekly digest', 'Ten articles about gardening.')).toBe('other');
  });

  it('never reads a canceled meeting as a rejection, even with apologetic wording', () => {
    expect(say('Interview update', 'Unfortunately our interviewer is out sick, so the interview has been canceled. We will be in touch to find a new time.')).toBe('cancellation');
    expect(say('Unfortunately', 'Unfortunately we need to reschedule the call.')).toBe('reschedule');
  });

  it('uses invitation files for confirmation, reschedule and cancellation', () => {
    const invite = (method: string, sequence: number, status = 'CONFIRMED') => classifyMessage({ subject: 'Invitation', text: '', sent: false, invite: { method, sequence, status, start: null, end: null, summary: 'Portfolio discussion', uid: 'u1' } }).classification;
    expect(invite('REQUEST', 0)).toBe('interview_confirmed');
    expect(invite('REQUEST', 2)).toBe('reschedule');
    expect(invite('CANCEL', 3, 'CANCELLED')).toBe('cancellation');
  });

  it('finds role titles and companies a message names', () => {
    expect(extractRoleTitles('Thank you for applying', 'Thank you for applying for the Product designer position at Northstar.')).toEqual(['Product designer']);
    expect(extractRoleTitles('Your application: Staff Designer at Lumen', '')).toEqual(['Staff Designer']);
    expect(extractRoleTitles('Hello', 'I am reaching out about the Product lead role at Fieldwork and the Staff designer role at Lumen.')).toEqual(expect.arrayContaining(['Product lead', 'Staff designer']));
    expect(extractCompanies('Thanks for applying to Atlas Studio', '', null)).toContain('Atlas Studio');
    expect(extractCompanies('Hello', '', 'Cedar Recruiting')).toContain('Cedar');
    expect(extractCompanies('Hello', '', 'Maya Chen')).toEqual([]);
    expect(looksJobRelated('Your interview with Northstar')).toBe(true);
    expect(looksJobRelated('Garden club newsletter')).toBe(false);
  });

  it('reads an interview time only when its zone is stated, in that zone', () => {
    expect(parseStatedTime('We look forward to it on Friday, October 16 at 10:00 MDT.', '2026-10-12T15:04:00Z')).toEqual({ local: '2026-10-16T10:00', zone: 'America/Denver', passage: 'Friday, October 16 at 10:00 MDT' });
    expect(parseStatedTime('See you Oct 20 at 2:30 pm ET', '2026-10-12T15:04:00Z')).toMatchObject({ local: '2026-10-20T14:30', zone: 'America/New_York' });
    expect(parseStatedTime('See you Friday, October 16 at 10:00.', '2026-10-12T15:04:00Z')).toBeNull();
    expect(parseStatedTime('Our call is on January 5 at 9:00 AM PT', '2026-12-20T00:00:00Z')).toMatchObject({ local: '2027-01-05T09:00', zone: 'America/Los_Angeles' });
  });
});

const identity = (id: string, company: string, role: string, extra: Partial<OpportunityIdentity> = {}): OpportunityIdentity => ({ id, company, role, domains: [], contacts: [], requisitionId: null, sourceUrl: null, archived: false, ...extra });
const subject = (fields: Partial<MatchSubject> & { subject: string; text?: string }): MatchSubject => ({ text: '', fromName: null, addresses: [], urls: [], requisitionIds: [], roleTitles: [], linkedByThread: [], linkedByReply: [], linkedByInvite: [], ...fields });

describe('matching correspondence to opportunities', () => {
  const designer = identity('ns-1', 'Northstar', 'Product designer');
  const senior = identity('ns-2', 'Northstar', 'Senior product designer');
  const atlas = identity('at-1', 'Atlas Studio', 'Product designer');

  it('a company domain alone never picks one of several roles at that company', () => {
    const result = matchOpportunity(subject({ subject: 'Hello from Northstar', text: 'Thanks for your time.', addresses: ['talent@northstar.example'] }), [designer, senior, atlas]);
    expect(result.level).toBe('ambiguous');
    expect(result.opportunityId).toBeNull();
    expect(result.candidates.map((candidate) => candidate.opportunityId).sort()).toEqual(['ns-1', 'ns-2']);
    for (const candidate of result.candidates) expect(candidate.evidence.map((entry) => entry.kind)).toContain('company_domain');
  });

  it('an explicit role title picks the right one of two roles, and a longer title is not mistaken for the shorter one', () => {
    const senior1 = matchOpportunity(subject({ subject: 'Your application for Senior Product Designer', addresses: ['talent@northstar.example'] }), [designer, senior, atlas]);
    expect(senior1).toMatchObject({ level: 'strong', opportunityId: 'ns-2' });
    const plain = matchOpportunity(subject({ subject: 'Your application for the Product designer role', addresses: ['talent@northstar.example'] }), [designer, senior, atlas]);
    expect(plain).toMatchObject({ level: 'strong', opportunityId: 'ns-1' });
  });

  it('a message that names two roles goes to review as multi-role correspondence', () => {
    const both = matchOpportunity(subject({ subject: 'Two openings', text: 'You could fit the Product designer role or the Senior product designer role.', addresses: ['talent@northstar.example'] }), [designer, senior]);
    expect(both).toMatchObject({ level: 'ambiguous', multiRole: true, opportunityId: null });
  });

  it('two recruiter threads with one recruiter stay with their own roles through thread identity', () => {
    const shared = 'jordan@talentbridge.example';
    const fieldwork = identity('fw-1', 'Fieldwork', 'Product lead', { contacts: [shared] });
    const lumen = identity('lu-1', 'Lumen', 'Staff designer', { contacts: [shared] });
    const threadA = matchOpportunity(subject({ subject: 'Re: Next steps', text: 'Checking in.', addresses: [shared], linkedByThread: ['fw-1'] }), [fieldwork, lumen]);
    expect(threadA).toMatchObject({ level: 'exact', opportunityId: 'fw-1' });
    const threadB = matchOpportunity(subject({ subject: 'Re: Next steps', text: 'Checking in.', addresses: [shared], linkedByThread: ['lu-1'] }), [fieldwork, lumen]);
    expect(threadB).toMatchObject({ level: 'exact', opportunityId: 'lu-1' });
    const fresh = matchOpportunity(subject({ subject: 'Quick question', text: 'Are you free to talk?', addresses: [shared] }), [fieldwork, lumen]);
    expect(fresh.level).toBe('ambiguous');
    expect(fresh.candidates.every((candidate) => candidate.evidence.some((entry) => entry.detail.includes('more than one')))).toBe(true);
  });

  it('a linked thread that names a different role of the same company is not silently attached', () => {
    const result = matchOpportunity(subject({ subject: 'Re: Portfolio', text: 'We would also like to consider you for the Senior product designer role.', addresses: ['maya@northstar.example'], linkedByThread: ['ns-1'] }), [designer, senior]);
    expect(result.level).toBe('ambiguous');
  });

  it('requisition IDs, posting links and reply references are exact evidence', () => {
    const withReq = identity('ns-1', 'Northstar', 'Product designer', { requisitionId: 'R-4821', sourceUrl: 'https://jobs.northstar.example/product-designer?ref=x' });
    expect(matchOpportunity(subject({ subject: 'Application received', requisitionIds: ['R-4821'] }), [withReq, senior])).toMatchObject({ level: 'exact', opportunityId: 'ns-1' });
    expect(matchOpportunity(subject({ subject: 'About your application', urls: ['https://www.jobs.northstar.example/product-designer/'] }), [withReq, senior])).toMatchObject({ level: 'exact', opportunityId: 'ns-1' });
    expect(matchOpportunity(subject({ subject: 'Re: hi', linkedByReply: ['ns-2'] }), [withReq, senior])).toMatchObject({ level: 'exact', opportunityId: 'ns-2' });
  });

  it('the only saved role at a company matches as probable, and a role title from another company is not evidence', () => {
    expect(matchOpportunity(subject({ subject: 'Thanks for applying to Atlas Studio', addresses: ['careers@atlasstudio.example'] }), [designer, atlas])).toMatchObject({ level: 'probable', opportunityId: 'at-1' });
    expect(matchOpportunity(subject({ subject: 'Product designer opening at Pinecrest', addresses: ['jobs@pinecrest.example'] }), [designer])).toMatchObject({ level: 'none' });
  });

  it('a message about a role that is not saved proposes it instead of attaching it to another role at that company', () => {
    const result = matchOpportunity(subject({ subject: 'Thank you for applying', text: 'Thank you for applying for the Design systems lead position.', addresses: ['talent@northstar.example'], roleTitles: ['Design systems lead'] }), [designer]);
    expect(result).toMatchObject({ level: 'none', otherRole: 'Design systems lead' });
  });

  it('archived opportunities only match on exact evidence', () => {
    const archived = identity('old-1', 'Cedar', 'Design lead', { archived: true });
    expect(matchOpportunity(subject({ subject: 'Design lead at Cedar', addresses: ['jobs@cedar.example'] }), [archived]).level).toBe('none');
    expect(matchOpportunity(subject({ subject: 'Re: offer', linkedByThread: ['old-1'] }), [archived])).toMatchObject({ level: 'exact', opportunityId: 'old-1' });
  });

  it('applicant tracking and personal mail domains never identify the employer', () => {
    const gh = matchOpportunity(subject({ subject: 'Update on your candidacy', addresses: ['no-reply@greenhouse.io'] }), [identity('n', 'Greenhouse', 'Product designer')]);
    expect(gh.level).toBe('none');
    expect(matchOpportunity(subject({ subject: 'Hi', addresses: ['someone@gmail.com'] }), [identity('g', 'Gmail', 'Designer')]).level).toBe('none');
  });
});

describe('compensation', () => {
  it('keeps exact minor units, currency, period and qualifiers as stated', () => {
    const [base] = parseCompensation('Base salary: $140,000 to $165,000 per year, plus equity.', 'posting');
    expect(base).toMatchObject({ kind: 'base', minMinor: 14_000_000, maxMinor: 16_500_000, currency: 'USD', period: 'year', qualifiers: ['base salary', 'plus equity'], passage: 'Base salary: $140,000 to $165,000 per year, plus equity.' });
    expect(formatCompensation(base)).toBe('$140,000 to $165,000 a year');
    const [hourly] = parseCompensation('Pay: $65.50/hr depending on experience', 'posting');
    expect(hourly).toMatchObject({ kind: 'hourly', minMinor: 6550, maxMinor: 6550, period: 'hour', qualifiers: ['depends on experience'] });
    expect(parseCompensation('Salary range $140-165K annually', 'posting')[0]).toMatchObject({ minMinor: 14_000_000, maxMinor: 16_500_000, period: 'year' });
    expect(parseCompensation('Total compensation (OTE) €70.000 to €90.000 per year', 'offer')[0]).toMatchObject({ kind: 'total', currency: 'EUR', minMinor: 7_000_000, maxMinor: 9_000_000, source: 'offer' });
    expect(parseCompensation('Base pay of 120,000 USD', 'posting')[0]).toMatchObject({ currency: 'USD', minMinor: 12_000_000, period: 'unstated' });
    expect(toMinorUnits('1.5', 'k', 'USD')).toBe(150_000);
    expect(toMinorUnits('500000', undefined, 'JPY')).toBe(500_000);
  });

  it('ignores money that is not pay, such as funding rounds', () => {
    expect(parseCompensation('We raised $40M in our Series B from fictional investors.', 'posting')).toEqual([]);
  });

  it('never compares an annual salary with an hourly rate or base with total without an explicit assumption', () => {
    const [year] = parseCompensation('Salary: $120,000 per year', 'posting');
    const [hour] = parseCompensation('Rate: $60 per hour', 'posting');
    const [total] = parseCompensation('Total compensation: $150,000 per year', 'posting');
    const [euro] = parseCompensation('Salary: €100,000 per year', 'posting');
    expect(compareCompensation(year, hour)).toMatchObject({ comparable: false });
    expect(compareCompensation(year, hour).reason).toMatch(/explicit assumption/);
    expect(compareCompensation(year, total).comparable).toBe(false);
    expect(compareCompensation(year, euro).reason).toMatch(/not converted/);
    expect(compareCompensation(year, parseCompensation('Salary: $130,000 per year', 'posting')[0]).comparable).toBe(true);
  });
});

describe('posting extraction', () => {
  const posting = `Product designer at Northstar
Location: Denver, CO (Hybrid, three days in office)
Req ID: R-4821

About Northstar
Northstar builds planning tools.

What you'll do
- Turn complex workflows into clear product experiences.
- Partner with research and engineering throughout delivery.

Benefits
- Fictional perk that is not a requirement.

Compensation
Base salary: $128,000 to $152,000 per year, plus equity.`;

  it('extracts fields with their exact passages and only requirement bullets under requirement headings', () => {
    const extracted = extractPosting(posting);
    expect(extracted.role).toEqual({ value: 'Product designer', passage: 'Product designer at Northstar' });
    expect(extracted.company?.value).toBe('Northstar');
    expect(extracted.location?.value).toBe('Denver, CO (Hybrid, three days in office)');
    expect(extracted.workArrangement?.value).toBe('hybrid');
    expect(extracted.requisitionId?.value).toBe('R-4821');
    expect(extracted.requirements.map((item) => item.text)).toEqual(['Turn complex workflows into clear product experiences.', 'Partner with research and engineering throughout delivery.']);
    for (const requirement of extracted.requirements) expect(posting).toContain(requirement.passage);
    expect(extracted.compensation[0]).toMatchObject({ minMinor: 12_800_000, maxMinor: 15_200_000, period: 'year' });
  });

  it('leaves unknown values unknown', () => {
    const extracted = extractPosting('We are a small team. Send us a note if you are curious.');
    expect(extracted.requirements).toEqual([]);
    expect(extracted.location).toBeNull();
    expect(extracted.compensation).toEqual([]);
  });
});

describe('text identity helpers', () => {
  it('normalizes companies, links, requisitions and titles', () => {
    expect(companyKey('Northstar, Inc.')).toBe('northstar');
    expect(urlKey('https://www.Jobs.Northstar.example/product-designer/?utm=x#top')).toBe('jobs.northstar.example/product-designer');
    expect(extractRequisitionIds('Job ID: 10442 and requisition #R-4821')).toEqual(['10442', 'R-4821']);
    expect(cleanTitle('the Product designer)')).toBe('Product designer');
    expect(cleanTitle('Denver, CO (Hybrid)')).toBe('Denver, CO (Hybrid)');
  });
});

describe('version compare', () => {
  it('shows added and removed lines between two texts', () => {
    const result = diffLines('Sam Rivera\nLong summary\nExperience', 'Sam Rivera\nShorter summary\nExperience\nPortfolio');
    expect(result.lines).toEqual([
      { type: 'same', text: 'Sam Rivera' },
      { type: 'removed', text: 'Long summary' },
      { type: 'added', text: 'Shorter summary' },
      { type: 'same', text: 'Experience' },
      { type: 'added', text: 'Portfolio' },
    ]);
  });
});

describe('preparation suggestions from supplied evidence', () => {
  const sources = boundedSources([
    { source: 'posting', ref: 'snap-1', label: 'Saved posting', text: '- Turn complex workflows into clear product experiences.\n- Comfort running usability studies with customers.', sourceKey: 'manual' },
    { source: 'material', ref: 'v3', label: 'Product design résumé v3', text: 'Led the redesign of account onboarding for dispatch teams.\nRan monthly usability studies with customer operations staff.', sourceKey: 'materials' },
  ] satisfies PrepSource[]);
  const reply = (suggestions: unknown[]) => JSON.stringify({ suggestions });

  it('marks sources as untrusted data and stays within the prompt bound', () => {
    const prompt = buildPreparationPrompt({ company: 'Northstar', role: 'Product designer', interview: 'Portfolio discussion', sources });
    expect(prompt).toContain('untrusted data');
    expect(prompt).toContain('Never invent employment');
    expect(prompt.length).toBeLessThanOrEqual(16000);
    const huge = boundedSources(Array.from({ length: 20 }, (_, index) => ({ source: 'material' as const, ref: `m${index}`, label: 'Long', text: 'x'.repeat(5000), sourceKey: 'materials' })));
    expect(buildPreparationPrompt({ company: 'A', role: 'B', interview: null, sources: huge }).length).toBeLessThanOrEqual(16000);
  });

  it('keeps suggestions that quote their sources exactly and drops invented experience, numbers or employers', () => {
    const result = validatePreparationReply(reply([
      { kind: 'talking_point', text: 'Walk through the onboarding redesign for dispatch teams and how usability studies shaped it.', evidence: [{ source: 'S2', quote: 'Led the redesign of account onboarding for dispatch teams.' }, { source: 'S1', quote: 'Comfort running usability studies with customers.' }] },
      { kind: 'talking_point', text: 'Mention your time leading design at Google.', evidence: [{ source: 'S2', quote: 'Led the redesign of account onboarding' }] },
      { kind: 'talking_point', text: 'Say the redesign raised activation by 40%.', evidence: [{ source: 'S2', quote: 'Led the redesign of account onboarding' }] },
      { kind: 'question', text: 'How do customers take part in research here?', evidence: [{ source: 'S1', quote: 'a quote that is not in the posting' }] },
      { kind: 'talking_point', text: 'Explain how you turn complex workflows into clear experiences.', evidence: [{ source: 'S1', quote: 'Turn complex workflows into clear product experiences.' }] },
      { kind: 'gap', text: 'The posting asks for research comfort. Your materials mention usability studies, but not customer interviews.', evidence: [{ source: 'S1', quote: 'Comfort running usability studies with customers.' }] },
    ]), sources, { company: 'Northstar', role: 'Product designer' });
    expect(result.suggestions.map((item) => item.kind)).toEqual(['talking_point', 'gap']);
    expect(result.rejected).toBe(4);
    expect(result.suggestions[0].evidence.map((entry) => entry.label)).toEqual(['Product design résumé v3', 'Saved posting']);
    expect(result.suggestions[0].evidence[0].sourceKey).toBe('materials');
    expect(unsupportedClaims('You led design at Google for 6 years', 'Led the redesign of account onboarding')).toEqual(expect.arrayContaining(['6', 'Google']));
  });

  it('refuses a reply that is not the requested structured data', () => {
    expect(() => validatePreparationReply('Here are some ideas: be confident!', sources, { company: 'Northstar', role: 'Product designer' })).toThrow(/structured/);
    expect(() => validatePreparationReply('{"suggestions":[{"kind":"poem","text":"x"}]}', sources, { company: 'Northstar', role: 'Product designer' })).toThrow(/format/);
  });
});
