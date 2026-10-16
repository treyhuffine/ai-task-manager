/** @jsxRuntime automatic */
import { useEffect, useMemo, useState } from 'react';
import {
  AskRiButton, Button, ButtonRow, Checkbox, DateInput, Dialog, FollowUpDialog, InlineError, KeyValueList, Menu, Notice, RadioGroup, Select, StatusLabel, TextArea, TextInput,
  useAnnounce, useMutation, useQuery, useRiApp,
} from '@ri/app-kit/ui';
import { isValidZone, localDate } from '@ri/app-kit/time';
import { CHANNELS, CHANNEL_LABELS, MATERIAL_KINDS, MATERIAL_LABELS, OUTCOME_LABELS, STAGE_LABELS, type Outcome, type Stage } from '../domain/labels.js';
import { compareCompensation, compensationLabel, formatCompensation } from '../domain/compensation.js';
import type { Compensation, Interview, MaterialFamily, OpportunityRecord, OpportunitySummary } from '../domain/model.js';
import type { ApplyResult, ListResult, OpportunityDetail, PreviewResult, Write } from './types.js';
import { errorText, locationText, newOperationId, shortDate, stageText, viewerZone } from './format.js';

// ─── Save a job ──────────────────────────────────────────────────────────────

type SaveMode = 'paste' | 'file' | 'link';
export function SaveJobDialog({ open, attachTo, onClose, onSaved }: { open: boolean; attachTo: string | null; onClose: () => void; onSaved: (opportunityId: string | null) => void }) {
  const app = useRiApp();
  const announce = useAnnounce();
  const [mode, setMode] = useState<SaveMode>('paste');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<{ name: string; mimeType: string; base64: string } | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [attach, setAttach] = useState<string>(attachTo ?? '');
  const [error, setError] = useState<string | null>(null);
  const previewRun = useMutation<Record<string, unknown>, PreviewResult>('preview_import');
  const apply = useMutation<Record<string, unknown>, ApplyResult>('apply_import');

  const runPreview = async () => {
    setError(null);
    try {
      const input: Record<string, unknown> = { kind: 'posting' };
      if (mode === 'paste' && text.trim()) input.text = text;
      if (mode === 'file' && file) input.file = file;
      if (url.trim()) input.url = url.trim();
      if (attachTo) input.opportunityId = attachTo;
      if (!input.text && !input.file && !input.url) return setError(mode === 'file' ? 'Choose a file first' : mode === 'link' ? 'Add the link to the posting' : 'Paste the job description first');
      const result = await previewRun.run(input);
      setPreview(result);
      setCompany(result.posting?.company ?? '');
      setRole(result.posting?.role ?? '');
      setLocation(result.posting?.location ?? '');
      if (!attachTo && result.duplicates[0]) setAttach('');
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  const save = async () => {
    if (!preview) return;
    setError(null);
    if (!attach && (!company.trim() || !role.trim())) return setError('Add the company and the role');
    try {
      const result = await apply.run({ previewId: preview.previewId, digest: preview.digest, decisions: attach ? { attachTo: attach } : { company: company.trim(), role: role.trim(), location: location.trim() || null } });
      announce(attach ? 'Description added as a new snapshot' : 'Job saved');
      onSaved(result.opportunityIds[0] ?? null);
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  const chooseFile = async () => {
    setError(null);
    try {
      const selected = await app.selectFile();
      if (selected) setFile(selected);
    } catch (failure) {
      setError(errorText(failure, 'The file could not be chosen'));
    }
  };
  const posting = preview?.posting;
  return (
    <Dialog
      open={open}
      wide
      title={attachTo ? 'Add the job description' : 'Save a job'}
      description={preview ? 'Check what will be saved. The description is kept exactly as captured, even if the posting changes or disappears.' : 'Save the description so it stays available even if the original posting disappears.'}
      onClose={onClose}
      busy={previewRun.pending || apply.pending}
      footer={preview ? (
        <>
          <Button variant="quiet" onClick={() => { setPreview(null); previewRun.reset(); apply.reset(); }}>Back</Button>
          <Button variant="primary" busy={apply.pending} busyLabel="Saving" onClick={save}>{attach ? 'Add to this opportunity' : 'Save job'}</Button>
        </>
      ) : (
        <>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={previewRun.pending} busyLabel="Reading" onClick={runPreview}>Preview</Button>
        </>
      )}
    >
      {!preview ? (
        <div className="ri-stack">
          <RadioGroup label="How do you want to add it" value={mode} onChange={(value) => setMode(value as SaveMode)} options={[
            { value: 'paste', label: 'Paste the description' },
            { value: 'file', label: 'Choose a PDF, Word or text file' },
            { value: 'link', label: 'Save the link', hint: 'The link is stored as written. It is not fetched.' },
          ]} />
          {mode === 'paste' && <TextArea label="Job description" value={text} onChange={setText} rows={10} placeholder="Paste the full posting, including requirements and pay if listed" />}
          {mode === 'file' && (
            <div className="ri-stack ri-stack--tight">
              <ButtonRow><Button onClick={chooseFile}>{file ? 'Choose a different file' : 'Choose file'}</Button></ButtonRow>
              <p className="ri-small ri-muted">{file ? `Chosen: ${file.name}` : 'PDF, Word, text, Markdown or HTML, up to 512 KB.'}</p>
            </div>
          )}
          <TextInput label="Link to the posting" hint={mode === 'link' ? 'Paste the description too if you can, so you can prepare with it' : 'Optional'} value={url} onChange={setUrl} placeholder="https://" inputMode="url" />
          {mode === 'link' && <TextArea label="Description" hint="Optional" value={text} onChange={(value) => { setText(value); }} rows={5} />}
          <InlineError>{error}</InlineError>
          {error && /Sources/.test(error) && <ButtonRow><Button size="sm" onClick={() => void app.openSources()}>Open Sources</Button></ButtonRow>}
        </div>
      ) : (
        <div className="ri-stack">
          {preview.warnings.map((warning) => <Notice key={warning} tone="info">{warning}</Notice>)}
          {!attachTo && preview.duplicates.length > 0 && (
            <div className="js-panel js-panel--soft">
              <p className="js-panel__title">This looks like a role you already saved</p>
              <RadioGroup label="Save it as" value={attach} onChange={setAttach} options={[
                { value: '', label: 'A new opportunity' },
                ...preview.duplicates.map((item) => ({ value: item.id, label: `A new description for ${item.company} · ${item.role}`, hint: `${STAGE_LABELS[item.stage]}. Earlier descriptions stay as they were.` })),
              ]} />
            </div>
          )}
          {!attach && (
            <div className="js-fields">
              <TextInput label="Company" value={company} onChange={setCompany} required />
              <TextInput label="Role" value={role} onChange={setRole} required />
              <TextInput label="Location" hint="Optional" value={location} onChange={setLocation} />
            </div>
          )}
          {posting && (
            <KeyValueList items={[
              { label: 'Description', value: posting.hasText ? `${posting.characters.toLocaleString('en-US')} characters${posting.fileName ? ` from ${posting.fileName}` : ''}` : 'Not added yet' },
              { label: 'Link', value: posting.sourceUrl ?? 'None' },
              { label: 'Requirements found', value: posting.requirementCount ? `${posting.requirementCount}` : 'None found' },
              { label: 'Work arrangement', value: posting.workArrangement ? { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On site' }[posting.workArrangement] : 'Not stated' },
              ...posting.compensation.slice(0, 2).map((item, index) => ({ key: `comp-${index}`, label: compensationLabel(item), value: formatCompensation(item) })),
            ]} />
          )}
          {posting && posting.requirements.length > 0 && (
            <div className="ri-stack ri-stack--tight">
              <h3 className="ri-h3">First requirements, as written</h3>
              <ul className="js-items">{posting.requirements.slice(0, 5).map((item) => <li key={item.id} className="ri-small">{item.text}</li>)}</ul>
            </div>
          )}
          <InlineError>{error}</InlineError>
        </div>
      )}
    </Dialog>
  );
}

// ─── Stage menu and recording an application ────────────────────────────────

const STAGE_ITEMS: { id: string; label: string; stage: Stage; outcome: Outcome | null }[] = [
  { id: 'saved', label: 'Saved', stage: 'saved', outcome: null },
  { id: 'applied', label: 'Applied', stage: 'applied', outcome: null },
  { id: 'interviewing', label: 'Interviewing', stage: 'interviewing', outcome: null },
  { id: 'offer', label: 'Offer', stage: 'offer', outcome: null },
  { id: 'rejected', label: 'Closed: rejected', stage: 'closed', outcome: 'rejected' },
  { id: 'withdrawn', label: 'Closed: withdrawn', stage: 'closed', outcome: 'withdrawn' },
  { id: 'accepted', label: 'Closed: accepted', stage: 'closed', outcome: 'accepted' },
];

/** Move to stage, the keyboard alternative to dragging. Choosing Applied from Saved records the application. */
export function StageMenu({ opportunity, onChanged, size = 'md' }: { opportunity: Pick<OpportunitySummary, 'id' | 'revision' | 'stage' | 'outcome' | 'company' | 'role'>; onChanged?: () => void; size?: 'sm' | 'md' }) {
  const announce = useAnnounce();
  const move = useMutation<Record<string, unknown>, Write<OpportunityRecord>>('change_stage');
  const [record, setRecord] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = opportunity.stage === 'closed' ? opportunity.outcome ?? 'rejected' : opportunity.stage;
  const choose = async (id: string) => {
    const item = STAGE_ITEMS.find((entry) => entry.id === id)!;
    if (item.id === current) return;
    if (item.stage === 'applied' && opportunity.stage === 'saved') { setRecord(true); return; }
    setError(null);
    try {
      const result = await move.run({ id: opportunity.id, expectedRevision: opportunity.revision, stage: item.stage, outcome: item.outcome });
      move.reset();
      if (result.status === 'conflict') {
        setError(`${result.message}. The stage is now ${stageText(result.current.stage, result.current.outcome)}.`);
        onChanged?.();
        return;
      }
      announce(`Moved to ${item.label}`);
      onChanged?.();
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  return (
    <>
      <Menu label="Move to stage" size={size} selectedId={current} items={STAGE_ITEMS.map((item) => ({ id: item.id, label: item.label }))} onSelect={(id) => void choose(id)} />
      {error && <InlineError>{error}</InlineError>}
      {record && <RecordApplicationDialog opportunity={opportunity} onClose={() => setRecord(false)} onSaved={() => { setRecord(false); onChanged?.(); }} />}
    </>
  );
}

export function RecordApplicationDialog({ opportunity, onClose, onSaved }: { opportunity: Pick<OpportunitySummary, 'id' | 'revision' | 'company' | 'role'>; onClose: () => void; onSaved: () => void }) {
  const announce = useAnnounce();
  const materials = useQuery<ListResult<MaterialFamily>>('list_materials', { limit: 100, archived: false });
  const [appliedOn, setAppliedOn] = useState<string | null>(localDate(new Date(), viewerZone));
  const [channel, setChannel] = useState<string>('company_site');
  const [versions, setVersions] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = useMutation<Record<string, unknown>, Write<{ submission: unknown; opportunity: OpportunityRecord }>>('record_submission');
  const save = async () => {
    setError(null);
    if (!appliedOn) return setError('Add the date you applied');
    if (!confirmed) return setError('Confirm that you submitted this application');
    try {
      const result = await submit.run({ opportunityId: opportunity.id, expectedRevision: opportunity.revision, appliedOn, channel, materialVersionIds: versions, confirmed, ...(note.trim() ? { note: note.trim() } : {}) });
      if (result.status === 'conflict') { submit.reset(); return setError(`${result.message}.`); }
      announce('Application recorded');
      onSaved();
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  return (
    <Dialog open title="Record your application" description={`${opportunity.company} · ${opportunity.role}. This only records what you did. Nothing is sent.`} onClose={onClose} busy={submit.pending}
      footer={<><Button variant="quiet" onClick={onClose}>Cancel</Button><Button variant="primary" busy={submit.pending} onClick={save}>{error && submit.invocationId ? 'Try again' : 'Record application'}</Button></>}>
      <div className="js-fields">
        <DateInput label="Date you applied" value={appliedOn} onChange={setAppliedOn} required />
        <Select label="How you applied" value={channel} onChange={setChannel} options={CHANNELS.map((value) => ({ value, label: CHANNEL_LABELS[value] }))} />
      </div>
      <fieldset className="ri-fieldset">
        <legend>Materials you submitted</legend>
        {!materials.data ? <p className="ri-small ri-muted">Loading materials</p> : materials.data.items.length === 0 ? <p className="ri-small ri-muted">No materials saved yet. You can still record the application.</p> : materials.data.items.map((family) => (
          <div key={family.id} className="ri-stack ri-stack--tight">
            <p className="ri-small"><strong>{family.title}</strong> <span className="ri-muted">{MATERIAL_LABELS[family.kind]}</span></p>
            {family.versions.slice(0, 4).map((version) => (
              <Checkbox key={version.id} label={`v${version.number}${version.number === family.latestNumber ? ', latest' : ''}`} hint={`${version.origin === 'original' ? 'Original' : 'Edited'} ${shortDate(version.createdAt)}${version.submitted ? ', already submitted elsewhere' : ''}`}
                checked={versions.includes(version.id)} onChange={(on) => setVersions((list) => (on ? [...list.filter((item) => !family.versions.some((other) => other.id === item)), version.id] : list.filter((item) => item !== version.id)))} />
            ))}
          </div>
        ))}
      </fieldset>
      <TextInput label="Note" hint="Optional" value={note} onChange={setNote} />
      <Checkbox label="I submitted this application" hint="Needed when there is no receipt email yet. A receipt is linked automatically if one arrives." checked={confirmed} onChange={setConfirmed} />
      <InlineError>{error}</InlineError>
    </Dialog>
  );
}

// ─── Interviews ──────────────────────────────────────────────────────────────

const COMMON_ZONES = ['America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago', 'America/New_York', 'America/Toronto', 'Europe/London', 'Europe/Berlin', 'Europe/Lisbon', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];
export function InterviewDialog({ opportunityId, interview, onClose, onSaved }: { opportunityId: string; interview?: Interview | null; onClose: () => void; onSaved: () => void }) {
  const announce = useAnnounce();
  const zoneStart = interview?.zone && isValidZone(interview.zone) ? interview.zone : viewerZone;
  const localStart = interview?.startAt ? (() => { const date = new Date(interview.startAt); const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zoneStart, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date); const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'; return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }; })() : null;
  const [title, setTitle] = useState(interview?.title ?? 'Interview');
  const [status, setStatus] = useState<string>(interview?.status ?? 'scheduled');
  const [date, setDate] = useState<string | null>(localStart?.date ?? null);
  const [time, setTime] = useState(localStart?.time ?? '10:00');
  const [zone, setZone] = useState(zoneStart);
  const [duration, setDuration] = useState(interview?.startAt && interview.endAt ? String(Math.round((Date.parse(interview.endAt) - Date.parse(interview.startAt)) / 60000)) : '45');
  const [format, setFormat] = useState<string>(interview?.format ?? 'video');
  const [link, setLink] = useState(interview?.meetingLink ?? '');
  const [people, setPeople] = useState((interview?.participants ?? []).filter((person) => person.role !== 'self').map((person) => person.name ?? person.email ?? '').join(', '));
  const [notes, setNotes] = useState(interview?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation<Record<string, unknown>, Write<Interview>>('save_interview');
  const zones = useMemo(() => [...new Set([zone, viewerZone, ...COMMON_ZONES])].filter((value) => isValidZone(value)), [zone]);
  const submit = async () => {
    setError(null);
    if (!title.trim()) return setError('Add a title');
    if (status === 'scheduled' && !date) return setError('Add the date, or choose scheduling needed');
    if (date && !/^\d{2}:\d{2}$/.test(time)) return setError('Use a time such as 10:00');
    const minutes = Number(duration);
    try {
      const fields: Record<string, unknown> = {
        title: title.trim(), status, format, meetingLink: link.trim() || null, notes: notes.trim() || null,
        ...(date ? { start: { local: `${date}T${time}`, zone }, durationMinutes: Number.isFinite(minutes) && minutes >= 5 ? Math.min(600, Math.round(minutes)) : 45 } : interview ? {} : {}),
      };
      if (!interview || interview.origin === 'manual') fields.participants = people.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 20).map((value) => (value.includes('@') ? { name: null, email: value } : { name: value, email: null }));
      const result = await save.run(interview ? { id: interview.id, expectedRevision: interview.revision, ...fields } : { opportunityId, ...fields });
      if (result.status === 'conflict') { save.reset(); return setError(`${result.message}.`); }
      announce(interview ? 'Interview updated' : 'Interview added');
      onSaved();
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  const imported = interview && interview.origin !== 'manual';
  return (
    <Dialog open wide title={interview ? 'Edit interview' : 'Add an interview'} description={imported ? 'This interview came from your calendar or email. Your changes are kept as corrections and later updates will not overwrite them. Your calendar is not changed.' : 'Times are kept in the interview\'s own time zone. Nothing is sent and no calendar is changed.'} onClose={onClose} busy={save.pending}
      footer={<><Button variant="quiet" onClick={onClose}>Cancel</Button><Button variant="primary" busy={save.pending} onClick={submit}>{interview ? 'Save changes' : 'Add interview'}</Button></>}>
      <TextInput label="Title" value={title} onChange={setTitle} required />
      <Select label="Status" value={status} onChange={setStatus} options={[{ value: 'scheduled', label: 'Scheduled' }, { value: 'scheduling_needed', label: 'Scheduling needed' }, { value: 'completed', label: 'Held' }, { value: 'canceled', label: 'Canceled' }]} />
      <div className="js-fields">
        <DateInput label="Date" value={date} onChange={setDate} hint={status === 'scheduling_needed' ? 'Optional until a time is confirmed' : undefined} />
        <TextInput label="Start time" value={time} onChange={setTime} placeholder="10:00" inputMode="numeric" />
        <Select label="Time zone" value={zone} onChange={setZone} options={zones.map((value) => ({ value, label: value.replace(/_/g, ' ') }))} />
        <TextInput label="Length in minutes" value={duration} onChange={setDuration} inputMode="numeric" />
      </div>
      <div className="js-fields">
        <Select label="Format" value={format} onChange={setFormat} options={[{ value: 'video', label: 'Video meeting' }, { value: 'phone', label: 'Phone call' }, { value: 'onsite', label: 'In person' }, { value: 'unknown', label: 'Not stated' }]} />
        <TextInput label="Meeting link" hint="Optional, https only" value={link} onChange={setLink} inputMode="url" />
      </div>
      {(!interview || interview.origin === 'manual') && <TextInput label="Who you will meet" hint="Names or addresses, separated by commas" value={people} onChange={setPeople} />}
      <TextArea label="Notes" hint="Your own notes. They stay even if the calendar event is removed." value={notes} onChange={setNotes} rows={3} />
      <InlineError>{error}</InlineError>
    </Dialog>
  );
}

// ─── Opportunity details ─────────────────────────────────────────────────────

interface CompensationDraft { id: string; kind: Compensation['kind']; min: string; max: string; currency: string; period: Compensation['period']; qualifiers: string; source: Compensation['source']; passage: string | null }
const toMinor = (value: string, currency: string) => {
  const clean = value.replace(/[^\d.]/g, '');
  if (!clean) return null;
  const [whole, fraction = ''] = clean.split('.');
  const digits = currency === 'JPY' ? 0 : 2;
  return Number(whole || '0') * 10 ** digits + Number((fraction + '00').slice(0, digits) || '0');
};
const fromMinor = (value: number | null, currency: string) => (value === null ? '' : currency === 'JPY' ? String(value) : (value / 100).toFixed(value % 100 ? 2 : 0));

export function DetailsDialog({ opportunity, onClose, onSaved }: { opportunity: OpportunityRecord; onClose: () => void; onSaved: (record: OpportunityRecord) => void }) {
  const announce = useAnnounce();
  const [form, setForm] = useState({
    company: opportunity.company, role: opportunity.role, location: opportunity.location ?? '', workArrangement: opportunity.workArrangement ?? '', sourceUrl: opportunity.sourceUrl ?? '',
    requisitionId: opportunity.requisitionId ?? '', nextAction: opportunity.nextAction ?? '', nextActionDue: opportunity.nextActionDue, deadline: opportunity.deadline, deadlineLabel: opportunity.deadlineLabel ?? '', notes: opportunity.notes ?? '',
  });
  const [compensation, setCompensation] = useState<CompensationDraft[]>(opportunity.compensation.map((item) => ({ id: item.id, kind: item.kind, min: fromMinor(item.minMinor, item.currency), max: fromMinor(item.maxMinor, item.currency), currency: item.currency, period: item.period, qualifiers: item.qualifiers.join(', '), source: item.source, passage: item.passage })));
  const [conflict, setConflict] = useState<OpportunityRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation<Record<string, unknown>, Write<OpportunityRecord>>('save_opportunity');
  const set = (key: keyof typeof form) => (value: string | null) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (revision = opportunity.revision) => {
    setError(null);
    try {
      const comp = compensation.filter((item) => item.min || item.max).map((item) => ({ id: item.id, kind: item.period === 'hour' && item.kind === 'base' ? 'hourly' as const : item.kind, minMinor: toMinor(item.min || item.max, item.currency), maxMinor: toMinor(item.max || item.min, item.currency), currency: item.currency, period: item.period, qualifiers: item.qualifiers.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 8), source: item.source, passage: item.passage }));
      const result = await save.run({
        id: opportunity.id, expectedRevision: revision, company: form.company, role: form.role, location: form.location || null, workArrangement: form.workArrangement || null, sourceUrl: form.sourceUrl || null,
        requisitionId: form.requisitionId || null, nextAction: form.nextAction || null, nextActionDue: form.nextAction ? form.nextActionDue : null, deadline: form.deadline, deadlineLabel: form.deadline ? form.deadlineLabel || 'Deadline' : null, notes: form.notes || null, compensation: comp,
      });
      if (result.status === 'conflict') { save.reset(); setConflict(result.current); return; }
      announce('Details saved');
      onSaved(result.record);
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  return (
    <Dialog open wide title="Edit details" description="Unknown values can stay empty. Pay is kept exactly as stated, with its period, and is never converted." onClose={onClose} busy={save.pending}
      footer={<><Button variant="quiet" onClick={onClose}>Cancel</Button><Button variant="primary" busy={save.pending} onClick={() => void submit()}>Save details</Button></>}>
      {conflict && (
        <Notice tone="warning" title="This opportunity changed while you edited" action={<ButtonRow><Button size="sm" variant="primary" onClick={() => { const revision = conflict.revision; setConflict(null); void submit(revision); }}>Keep my changes</Button><Button size="sm" onClick={() => onSaved(conflict)}>Use current values</Button></ButtonRow>}>
          Now: {conflict.company} · {conflict.role}, {stageText(conflict.stage, conflict.outcome)}{conflict.nextAction ? `, next action ${conflict.nextAction}` : ''}. Your edits are still here.
        </Notice>
      )}
      <div className="js-fields">
        <TextInput label="Company" value={form.company} onChange={set('company')} required />
        <TextInput label="Role" value={form.role} onChange={set('role')} required />
        <TextInput label="Location" value={form.location} onChange={set('location')} />
        <Select label="Work arrangement" value={form.workArrangement} onChange={set('workArrangement')} options={[{ value: '', label: 'Not known' }, { value: 'remote', label: 'Remote' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'onsite', label: 'On site' }]} />
        <TextInput label="Posting link" value={form.sourceUrl} onChange={set('sourceUrl')} inputMode="url" />
        <TextInput label="Requisition ID" hint="Helps match email to this role" value={form.requisitionId} onChange={set('requisitionId')} />
      </div>
      <div className="js-fields">
        <TextInput label="Next action you chose" value={form.nextAction} onChange={set('nextAction')} />
        <DateInput label="Do it by" hint="Optional" value={form.nextActionDue} onChange={set('nextActionDue')} />
        <DateInput label="Deadline" hint="Only a date someone stated, such as an offer reply date" value={form.deadline} onChange={set('deadline')} />
        <TextInput label="Deadline label" value={form.deadlineLabel} onChange={set('deadlineLabel')} placeholder="Reply to the offer by" />
      </div>
      <fieldset className="ri-fieldset">
        <legend>Compensation as stated</legend>
        {compensation.map((item, index) => (
          <div key={item.id} className="js-fields">
            <Select label="Kind" value={item.kind} onChange={(value) => setCompensation((list) => list.map((entry, at) => (at === index ? { ...entry, kind: value as Compensation['kind'] } : entry)))} options={[{ value: 'base', label: 'Base salary' }, { value: 'total', label: 'Total compensation' }, { value: 'hourly', label: 'Hourly rate' }, { value: 'bonus', label: 'Bonus' }, { value: 'equity', label: 'Equity' }, { value: 'other', label: 'Other' }]} />
            <TextInput label="From" value={item.min} onChange={(value) => setCompensation((list) => list.map((entry, at) => (at === index ? { ...entry, min: value } : entry)))} inputMode="decimal" />
            <TextInput label="To" hint="Optional" value={item.max} onChange={(value) => setCompensation((list) => list.map((entry, at) => (at === index ? { ...entry, max: value } : entry)))} inputMode="decimal" />
            <TextInput label="Currency" value={item.currency} onChange={(value) => setCompensation((list) => list.map((entry, at) => (at === index ? { ...entry, currency: value.toUpperCase().slice(0, 3) } : entry)))} />
            <Select label="Period" value={item.period} onChange={(value) => setCompensation((list) => list.map((entry, at) => (at === index ? { ...entry, period: value as Compensation['period'] } : entry)))} options={[{ value: 'year', label: 'A year' }, { value: 'month', label: 'A month' }, { value: 'week', label: 'A week' }, { value: 'day', label: 'A day' }, { value: 'hour', label: 'An hour' }, { value: 'one_time', label: 'One time' }, { value: 'unstated', label: 'Not stated' }]} />
            <TextInput label="Qualifiers" hint="Such as base salary, plus equity" value={item.qualifiers} onChange={(value) => setCompensation((list) => list.map((entry, at) => (at === index ? { ...entry, qualifiers: value } : entry)))} />
            <Button variant="link" size="sm" onClick={() => setCompensation((list) => list.filter((_, at) => at !== index))}>Remove this amount</Button>
          </div>
        ))}
        <ButtonRow><Button size="sm" onClick={() => setCompensation((list) => [...list, { id: newOperationId().slice(0, 16), kind: 'base', min: '', max: '', currency: 'USD', period: 'year', qualifiers: '', source: 'user', passage: null }])}>Add an amount</Button></ButtonRow>
      </fieldset>
      <TextArea label="Notes" value={form.notes} onChange={set('notes')} rows={3} />
      <InlineError>{error}</InlineError>
    </Dialog>
  );
}

// ─── Follow-ups ──────────────────────────────────────────────────────────────

/** One Ri task linked to this record. The operation ID is chosen when the dialog opens, so a retry or a second click returns the same task. */
export function FollowUpButton({ subject, label, defaultTitle, defaultDue, onCreated }: { subject: { type: 'opportunity' | 'interview'; id: string }; label: string; defaultTitle: string; defaultDue?: string | null; onCreated?: () => void }) {
  const app = useRiApp();
  const [open, setOpen] = useState(false);
  const [operationId, setOperationId] = useState(newOperationId);
  const create = useMutation<Record<string, unknown>, { followUp: { title: string; dueAt: string | null } }>('create_follow_up');
  const [blocked, setBlocked] = useState(false);
  return (
    <>
      <Button onClick={() => { setOpen(true); create.reset(); setBlocked(false); }}>Create follow-up</Button>
      <FollowUpDialog
        open={open}
        defaultTitle={defaultTitle}
        defaultDueDate={defaultDue ?? null}
        allowDueDate
        subject={label}
        onClose={() => { setOpen(false); if (create.invocationId === null) setOperationId(newOperationId()); }}
        onCreate={async (title, dueAt) => {
          try {
            await create.run({ subject, title, ...(dueAt ? { dueAt } : {}), operationId });
            setOperationId(newOperationId());
            onCreated?.();
          } catch (failure) {
            if (/allow ri tasks|not allowed/i.test(errorText(failure))) setBlocked(true);
            throw failure;
          }
        }}
      />
      {blocked && open && <Notice tone="warning" title="Ri tasks are not allowed for this app yet" action={<Button size="sm" onClick={() => void app.openSources()}>Open Sources</Button>}>Allow Ri tasks for Job Search in Sources, then create the follow-up again.</Notice>}
    </>
  );
}

// ─── Compare roles ───────────────────────────────────────────────────────────

export function CompareDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [details, setDetails] = useState<OpportunityDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const app = useRiApp();
  useEffect(() => {
    let active = true;
    Promise.all(ids.map((id) => app.call<OpportunityDetail>('get_opportunity', { id }))).then((list) => active && setDetails(list), (failure) => active && setError(errorText(failure)));
    return () => { active = false; };
  }, [ids, app]);
  const roles = details?.map((detail) => detail.opportunity) ?? [];
  const firstComp = (record: OpportunityRecord) => record.compensation.find((item) => item.kind === 'base' || item.kind === 'hourly' || item.kind === 'total') ?? record.compensation[0] ?? null;
  const comps = roles.map(firstComp);
  const comparable = comps.length > 1 && comps.every(Boolean) ? comps.slice(1).map((item) => compareCompensation(comps[0]!, item!)) : [];
  const note = comps.some((item) => !item) ? 'Some roles have no stated pay, so pay is not compared.' : comparable.find((result) => !result.comparable)?.reason ?? (comparable.length ? 'Pay is stated the same way for these roles.' : null);
  const prompt = `Compare these roles using only their saved details: ${roles.map((record) => `${record.company} ${record.role}`).join(', ')}. Use the stated requirements, stage, location and pay exactly as recorded, do not convert pay between periods, and say what is unknown.`;
  const rows: { label: string; value: (detail: OpportunityDetail) => string }[] = [
    { label: 'Stage', value: (detail) => stageText(detail.opportunity.stage, detail.opportunity.outcome) },
    { label: 'Location', value: (detail) => locationText(detail.opportunity) },
    { label: 'Pay as stated', value: (detail) => detail.opportunity.compensation.length ? detail.opportunity.compensation.slice(0, 2).map((item) => `${compensationLabel(item)}: ${formatCompensation(item)}${item.qualifiers.length ? ` (${item.qualifiers.join(', ')})` : ''}`).join('. ') : 'Not stated' },
    { label: 'Stated requirements', value: (detail) => detail.requirements.length ? `${detail.requirements.length} saved from the posting` : 'No description saved' },
    { label: 'Interviews', value: (detail) => detail.interviews.filter((item) => item.status === 'scheduled').length ? `${detail.interviews.filter((item) => item.status === 'scheduled').length} scheduled` : 'None scheduled' },
    { label: 'Submitted', value: (detail) => detail.submissions[0] ? `${shortDate(detail.submissions[0].appliedOn)} with ${detail.submissions[0].materials.map((material) => (material.number ? `${material.title} v${material.number}` : material.title)).join(', ') || 'no recorded materials'}` : 'Not recorded' },
  ];
  return (
    <Dialog open wide title="Compare roles" description="Only the details you saved. Unknown values stay unknown." onClose={onClose} footer={<><Button variant="quiet" onClick={onClose}>Close</Button><AskRiButton variant="primary" prompt={prompt}>Compare with Ri</AskRiButton></>}>
      {error ? <InlineError>{error}</InlineError> : !details ? <p className="ri-muted">Loading roles</p> : (
        <div className="ri-stack">
          <div className="js-compare-wrap">
            <table className="js-compare">
              <caption className="ri-sr-only">Selected roles compared</caption>
              <thead><tr><th scope="col">Detail</th>{details.map((detail) => <th scope="col" key={detail.opportunity.id}>{detail.opportunity.company} · {detail.opportunity.role}</th>)}</tr></thead>
              <tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{details.map((detail) => <td key={detail.opportunity.id}>{row.value(detail)}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {note && <p className="ri-small ri-muted">{note}</p>}
        </div>
      )}
    </Dialog>
  );
}

// ─── Materials ───────────────────────────────────────────────────────────────

export function AddMaterialDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (familyId: string | null) => void }) {
  const app = useRiApp();
  const announce = useAnnounce();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<string>('resume');
  const [text, setText] = useState('');
  const [file, setFile] = useState<{ name: string; mimeType: string; base64: string } | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewRun = useMutation<Record<string, unknown>, PreviewResult>('preview_import');
  const apply = useMutation<Record<string, unknown>, ApplyResult>('apply_import');
  const run = async () => {
    setError(null);
    try {
      if (!preview) {
        if (!text.trim() && !file) return setError('Paste the text or choose a file');
        const result = await previewRun.run({ kind: 'material', materialKind: kind, ...(title.trim() ? { title: title.trim() } : {}), ...(file ? { file } : { text }) });
        setPreview(result);
        if (!title.trim() && result.material) setTitle(result.material.title);
        return;
      }
      const result = await apply.run({ previewId: preview.previewId, digest: preview.digest, decisions: { title: title.trim() || preview.material?.title, materialKind: kind } });
      announce(result.created ? 'Material saved as version 1' : 'This text was already saved');
      onSaved(result.materialId);
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  return (
    <Dialog open wide title="Add a material" description="A résumé, cover letter or other material. It is saved as version 1, the original. Editing later saves new versions." onClose={onClose} busy={previewRun.pending || apply.pending}
      footer={<><Button variant="quiet" onClick={preview ? () => { setPreview(null); previewRun.reset(); } : onClose}>{preview ? 'Back' : 'Cancel'}</Button><Button variant="primary" busy={previewRun.pending || apply.pending} onClick={run}>{preview ? 'Save material' : 'Preview'}</Button></>}>
      <div className="js-fields">
        <TextInput label="Name" value={title} onChange={setTitle} placeholder="Product design résumé" />
        <Select label="Kind" value={kind} onChange={setKind} options={MATERIAL_KINDS.map((value) => ({ value, label: MATERIAL_LABELS[value] }))} />
      </div>
      {!preview ? (
        <>
          <ButtonRow>
            <Button onClick={async () => { try { const chosen = await app.selectFile(); if (chosen) { setFile(chosen); setText(''); } } catch (failure) { setError(errorText(failure)); } }}>{file ? 'Choose a different file' : 'Choose file'}</Button>
            {file && <span className="ri-small ri-muted">Chosen: {file.name}</span>}
          </ButtonRow>
          {!file && <TextArea label="Or paste the text" value={text} onChange={setText} rows={10} />}
        </>
      ) : (
        <div className="ri-stack ri-stack--tight">
          {preview.warnings.map((warning) => <Notice key={warning} tone="info">{warning}</Notice>)}
          <p className="ri-small ri-muted">{preview.material?.characters.toLocaleString('en-US')} characters{preview.material?.fileName ? ` from ${preview.material.fileName}` : ''}</p>
          <pre className="js-doc">{preview.material?.excerpt}</pre>
        </div>
      )}
      <InlineError>{error}</InlineError>
    </Dialog>
  );
}

export { STAGE_ITEMS, OUTCOME_LABELS, StatusLabel };
