/** @jsxRuntime automatic */
import { useEffect, useState } from 'react';
import {
  AskRiButton, Button, ButtonRow, DataTable, EmptyState, ErrorState, InlineError, Inspector, LoadingState, Notice, Select, SplitView, TextArea, TextInput, Toolbar,
  useAnnounce, useMutation, useQuery, useRiApp,
} from '@ri/app-kit/ui';
import { MATERIAL_LABELS } from '../domain/labels.js';
import type { CompareResult, ListResult, MaterialDetail, MaterialFamily, MaterialVersion, Write } from './types.js';
import { AddMaterialDialog } from './dialogs.js';
import { errorText, mediumDate, shortDate } from './format.js';

function stateText(version: MaterialVersion, family: MaterialFamily): string {
  const parent = family.versions.find((item) => item.id === version.parentId);
  const parts = [version.origin === 'original' ? 'Original' : parent ? `Edited from v${parent.number}` : 'Edited'];
  const latestNumber = family.latestNumber;
  if (version.submitted) parts.push('Submitted');
  else if (version.number === latestNumber) parts.push('Draft, not submitted');
  return parts.join(' · ');
}

export function MaterialsView({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  const app = useRiApp();
  const [archived, setArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const list = useQuery<ListResult<MaterialFamily>>('list_materials', { limit: 100, archived });
  const items = list.data?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? null;
  useEffect(() => {
    app.context({ section: 'materials', selected: selectedId ? [{ type: 'material', id: selectedId }] : [] });
  }, [app, selectedId]);
  const listContent = (
    <div className="ri-stack">
      <div className="ri-section-heading">
        <h2 className="ri-h2">Your materials, with history</h2>
        <p>Submitted versions stay unchanged</p>
      </div>
      <Toolbar end={<Button variant="primary" onClick={() => setAdding(true)}>Add material</Button>}>
        <Select label="Show" hideLabel value={archived ? 'archived' : 'current'} onChange={(value) => setArchived(value === 'archived')} options={[{ value: 'current', label: 'Current materials' }, { value: 'archived', label: 'Archived materials' }]} />
      </Toolbar>
      {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} />
        : !list.data ? <LoadingState label="Loading materials" />
          : items.length === 0 ? (
            <EmptyState compact title={archived ? 'Nothing archived' : 'No materials yet'} action={archived ? undefined : <Button variant="primary" onClick={() => setAdding(true)}>Add material</Button>}>
              <p>Add a résumé or cover letter from a file or pasted text. Each edit becomes a new version, and applications keep pointing at the exact version you sent.</p>
            </EmptyState>
          ) : (
            <DataTable
              caption="Materials"
              captionHidden
              rows={items}
              rowKey="id"
              selectedKey={selectedId}
              onSelect={(key) => onSelect(key)}
              rowLabel={(row) => `${row.title}, version ${row.latestNumber}`}
              columns={[
                { key: 'title', label: 'Material', render: (row) => <span className="ri-stack" style={{ gap: '0.125rem' }}><span>{row.title}</span><span className="ri-small ri-muted" style={{ fontWeight: 400 }}>{MATERIAL_LABELS[row.kind]}</span></span> },
                { key: 'version', label: 'Version', render: (row) => { const submitted = row.versions.find((version) => version.submitted); return `v${row.latestNumber}${row.versions[0]?.submitted ? ', submitted' : row.versions.length > 1 || !submitted ? ', not submitted' : ''}${submitted && submitted.number !== row.latestNumber ? `. v${submitted.number} submitted` : ''}`; } },
                { key: 'used', label: 'Used for', render: (row) => { const uses = row.versions.flatMap((version) => version.usedBy.map((use) => `${use.company} v${version.number}, ${shortDate(use.appliedOn)}`)); return uses.length ? uses.slice(0, 2).join('. ') + (uses.length > 2 ? `. ${uses.length - 2} more` : '') : 'Not submitted yet'; } },
                { key: 'updated', label: 'Updated', render: (row) => mediumDate(row.updatedAt) },
              ]}
            />
          )}
    </div>
  );
  return (
    <>
      <SplitView list={listContent} detailOpen={Boolean(selected)} onBack={() => onSelect(null)} backLabel="Back to materials" detailLabel={selected?.title} detail={selected && <MaterialDetailView key={selected.id} family={selected} onClose={() => onSelect(null)} onChanged={list.reload} />} />
      {adding && <AddMaterialDialog onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); list.reload(); if (id) onSelect(id); }} />}
    </>
  );
}

function MaterialDetailView({ family, onClose, onChanged }: { family: MaterialFamily; onClose: () => void; onChanged: () => void }) {
  const announce = useAnnounce();
  const [versionId, setVersionId] = useState(family.latestVersionId);
  const [mode, setMode] = useState<'read' | 'edit' | 'compare'>('read');
  const [editText, setEditText] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editParent, setEditParent] = useState<string | null>(null);
  const [compareWith, setCompareWith] = useState<string>('');
  const [conflict, setConflict] = useState<MaterialFamily | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!family.versions.some((version) => version.id === versionId)) setVersionId(family.latestVersionId); }, [family, versionId]);
  const version = family.versions.find((item) => item.id === versionId) ?? family.versions[0];
  const detail = useQuery<MaterialDetail>('get_material', { id: family.id, versionId: version.id });
  const other = compareWith || family.versions.find((item) => item.id !== version.id)?.id || '';
  const diff = useQuery<CompareResult>('compare_material_versions', { fromVersionId: other, toVersionId: version.id }, { enabled: mode === 'compare' && Boolean(other) });
  const save = useMutation<Record<string, unknown>, Write<{ material: MaterialFamily; version: MaterialVersion }>>('save_material_version');
  const archive = useMutation<Record<string, unknown>, Write<MaterialFamily>>('archive_material');

  const startEdit = () => {
    if (!detail.data?.textAvailable || detail.data.version.id !== version.id) return;
    setEditText(detail.data.text);
    setEditParent(version.id);
    setEditNote('');
    setConflict(null);
    setMode('edit');
  };
  const saveVersion = async (revision = family.revision) => {
    setError(null);
    try {
      const result = await save.run({ familyId: family.id, parentVersionId: editParent ?? version.id, expectedRevision: revision, text: editText, ...(editNote.trim() ? { note: editNote.trim() } : {}) });
      save.reset();
      if (result.status === 'conflict') { setConflict(result.current.material); return; }
      announce(`Saved as v${result.record.version.number}. Earlier versions are unchanged`);
      setMode('read');
      setVersionId(result.record.version.id);
      onChanged();
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  return (
    <Inspector
      eyebrow={MATERIAL_LABELS[family.kind]}
      title={family.title}
      subtitle={`${family.versions.length} version${family.versions.length === 1 ? '' : 's'} · Latest v${family.latestNumber}`}
      onClose={onClose}
      actions={mode === 'edit' ? (
        <>
          <Button variant="primary" busy={save.pending} busyLabel="Saving" onClick={() => void saveVersion()}>Save as v{family.latestNumber + 1}</Button>
          <Button variant="quiet" onClick={() => setMode('read')}>Cancel</Button>
        </>
      ) : (
        <>
          <Button variant="primary" onClick={startEdit} disabled={!detail.data?.textAvailable}>Edit as a new version</Button>
          {family.versions.length > 1 && <Button onClick={() => setMode(mode === 'compare' ? 'read' : 'compare')}>{mode === 'compare' ? 'Show text' : 'Compare versions'}</Button>}
          <AskRiButton prompt={`Help me review "${family.title}" v${version.number}, the ${MATERIAL_LABELS[family.kind].toLowerCase()} in Job Search. Suggest edits I can make myself. Do not invent experience, employers or credentials.`}>Ask Ri about it</AskRiButton>
          <Button variant="quiet" busy={archive.pending} onClick={async () => { try { await archive.run({ id: family.id, expectedRevision: family.revision, archived: !family.archivedAt }); archive.reset(); announce(family.archivedAt ? 'Restored' : 'Archived. Every version is kept'); onChanged(); } catch (failure) { setError(errorText(failure)); } }}>{family.archivedAt ? 'Restore' : 'Archive'}</Button>
        </>
      )}
    >
      <div className="js-versions" role="list" aria-label="Versions">
        {family.versions.map((item) => (
          <div role="listitem" key={item.id}>
            <button type="button" className="js-version" aria-current={item.id === version.id || undefined} onClick={() => { setVersionId(item.id); if (mode === 'edit') setMode('read'); }}>
              <span className="js-version__head">
                <strong>v{item.number}</strong>
                {item.submitted && <span className="js-tag js-tag--strong">Submitted</span>}
                {item.origin === 'original' && <span className="js-tag">Original</span>}
                {!item.submitted && item.number === family.latestNumber && <span className="js-tag">Draft</span>}
                <span className="ri-small ri-muted">{mediumDate(item.createdAt)}</span>
              </span>
              <span className="ri-small ri-muted">{stateText(item, family)}{item.fileName ? ` · From ${item.fileName}` : ''}{item.note ? ` · ${item.note}` : ''}</span>
              {item.usedBy.length > 0 && <span className="ri-small">Used for {item.usedBy.map((use) => `${use.company} · ${use.role} (${shortDate(use.appliedOn)})`).join(', ')}</span>}
            </button>
          </div>
        ))}
      </div>
      {conflict && (
        <Notice tone="warning" title={`A newer version, v${conflict.latestNumber}, was saved while you edited`} action={<ButtonRow><Button size="sm" variant="primary" onClick={() => void saveVersion(conflict.revision)}>Save mine as v{conflict.latestNumber + 1}</Button><Button size="sm" onClick={() => { setMode('compare'); setVersionId(conflict.latestVersionId); }}>Compare first</Button></ButtonRow>}>
          Your text is still in the editor. Saving keeps both versions.
        </Notice>
      )}
      {mode === 'edit' ? (
        <div className="ri-stack">
          <p className="ri-small ri-muted">Editing a copy of v{family.versions.find((item) => item.id === editParent)?.number}. Saving creates v{family.latestNumber + 1} and leaves every earlier version, and every recorded submission, unchanged.</p>
          <TextArea label="Text" value={editText} onChange={setEditText} rows={18} />
          <TextInput label="What changed" hint="Optional" value={editNote} onChange={setEditNote} />
        </div>
      ) : mode === 'compare' ? (
        <div className="ri-stack">
          <Select label="Compare with" value={other} onChange={setCompareWith} options={family.versions.filter((item) => item.id !== version.id).map((item) => ({ value: item.id, label: `v${item.number}${item.submitted ? ', submitted' : ''}` }))} />
          {diff.error ? <InlineError>{diff.error}</InlineError> : !diff.data || diff.data.to.id !== version.id || diff.data.from.id !== other ? <p className="ri-small ri-muted">Comparing</p> : (
            <>
              <p className="ri-small ri-muted">From v{diff.data.from.number} to v{diff.data.to.number}: {diff.data.added} line{diff.data.added === 1 ? '' : 's'} added, {diff.data.removed} removed{diff.data.truncated ? '. Long texts are compared in part' : ''}</p>
              <div className="js-diff" role="list" aria-label={`Changes from v${diff.data.from.number} to v${diff.data.to.number}`} tabIndex={0}>
                {diff.data.lines.map((line, index) => (
                  <div role="listitem" className="js-diff__line" data-type={line.type} key={index}>
                    <span className="js-diff__tag">{line.type === 'added' ? `Added in v${diff.data!.to.number}` : line.type === 'removed' ? `Only in v${diff.data!.from.number}` : ''}</span>
                    <span>{line.text || ' '}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : detail.error ? <InlineError>{detail.error}</InlineError> : !detail.data || detail.data.version.id !== version.id ? <p className="ri-small ri-muted">Loading text</p> : (
        <div className="ri-stack ri-stack--tight">
          <p className="ri-small ri-muted">v{version.number} · {stateText(version, family)} · {version.characters.toLocaleString('en-US')} characters · Digest {version.contentDigest.slice(0, 10)}</p>
          {detail.data.textAvailable ? <pre className="js-doc" tabIndex={0} aria-label={`${family.title} version ${version.number}`}>{detail.data.text}</pre> : <Notice tone="warning" title="This version's text is unavailable">Its record and digest are kept.</Notice>}
        </div>
      )}
      <InlineError>{error}</InlineError>
    </Inspector>
  );
}
