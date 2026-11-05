/** @jsxRuntime automatic */
/** @jsxImportSource react */
/** Import: choose a file or paste links, see what it would do, then apply that preview once. */
import { useEffect, useState } from "react";
import { Button, Dialog, InlineError, LoadingState, Notice, plural, SegmentedControl, TextArea, useAnnounce, useMutation, useRiApp } from "@ri/app-kit/ui";
import type { ImportPreview, ImportResult } from "../schemas.js";
import { errorMessage, readSelectedFile, splitParts, uuid } from "./util.js";

type Mode = "file" | "paste";
const FORMATS: Record<ImportPreview["format"], string> = { browser_html: "Bookmarks file", csv: "CSV file", link_list: "List of links" };

export function ImportDialog({ open, onClose, onApplied }: { open: boolean; onClose(): void; onApplied(): void }) {
  const app = useRiApp();
  const announce = useAnnounce();
  const apply = useMutation<Record<string, unknown>, ImportResult>("apply_import");
  const [mode, setMode] = useState<Mode>("file");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setMode("file"); setText(""); setPreview(null); setResult(null); setReading(null); setProblem(null); apply.reset(); }
  }, [open]);
  const chooseFile = async () => {
    setProblem(null);
    try {
      const file = await app.selectFile();
      if (!file) return;
      setReading("Reading the file");
      const parts = splitParts(readSelectedFile(file.base64));
      const uploadId = uuid();
      for (const [part, chunk] of parts.entries()) {
        if (parts.length > 1) setReading(`Reading the file, part ${part + 1} of ${parts.length}`);
        await app.call("upload_import_part", { uploadId, part, total: parts.length, text: chunk });
      }
      setReading("Looking through your links");
      setPreview(await app.call<ImportPreview>("preview_import", { uploadId, fileName: file.name }));
    } catch (error) {
      setProblem(errorMessage(error, "This file could not be read. Choose it again."));
    } finally {
      setReading(null);
    }
  };
  const readPasted = async () => {
    if (!text.trim()) return setProblem("Paste some links first");
    setProblem(null);
    setReading("Looking through your links");
    try {
      setPreview(await app.call<ImportPreview>("preview_import", { text }));
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setReading(null);
    }
  };
  const confirm = async () => {
    if (!preview) return;
    setProblem(null);
    try {
      const applied = await apply.run({ previewId: preview.previewId, digest: preview.digest });
      apply.reset();
      setResult(applied);
      announce(`Imported ${applied.added} links`);
      onApplied();
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };
  const footer = result ? (
    <Button variant="primary" onClick={onClose}>Done</Button>
  ) : preview ? (
    <>
      <Button variant="quiet" onClick={() => { setPreview(null); setProblem(null); }} disabled={apply.pending}>Back</Button>
      <Button variant="primary" busy={apply.pending} busyLabel="Importing" onClick={() => void confirm()}>Import {plural(preview.total, "link", "links")}</Button>
    </>
  ) : (
    <>
      <Button variant="quiet" onClick={onClose} disabled={!!reading}>Cancel</Button>
      {mode === "paste" && <Button variant="primary" busy={!!reading} busyLabel="Reading" onClick={() => void readPasted()}>Continue</Button>}
    </>
  );
  return (
    <Dialog open={open} title="Import bookmarks" description={preview ? undefined : "Nothing changes until you confirm. Links you already have merge, so importing twice is safe."} onClose={onClose} busy={apply.pending || !!reading} footer={footer}>
      {result ? (
        <Notice tone="success" title={`Imported ${plural(result.added, "new link", "new links")}.`} live>
          {[result.updated ? `${plural(result.updated, "link", "links")} you already had gained tags or dates.` : null, result.unchanged ? `${plural(result.unchanged, "link was", "links were")} already up to date.` : null].filter(Boolean).join(" ") || "Everything in the file is now in Bookmarks."}
        </Notice>
      ) : preview ? (
        <div className="ri-stack">
          <p className="ri-muted ri-small">{FORMATS[preview.format]}{preview.fileName ? `, ${preview.fileName}` : ""}</p>
          <div className="bm-counts">
            <span><strong>{preview.fresh.toLocaleString()}</strong> new</span>
            <span><strong>{preview.known.toLocaleString()}</strong> already saved</span>
            {preview.skipped > 0 && <span><strong>{preview.skipped.toLocaleString()}</strong> skipped, not web links</span>}
          </div>
          {preview.truncated && <Notice tone="warning">This file holds more than one import can take. The first 50,000 links are here. Import the rest in a smaller file.</Notice>}
          {preview.tags.length > 0 && (
            <div className="ri-stack ri-stack--tight">
              <p className="ri-small ri-muted">Folders and tags become tags</p>
              <div className="bm-tags">{preview.tags.map((item) => <span className="bm-tag" key={item.tag}>{item.tag} {item.count}</span>)}</div>
            </div>
          )}
          <ul className="bm-list" aria-label="First links in this import">
            {preview.samples.map((sample) => (
              <li key={sample.url}><span className="bm-row" style={{ gridTemplateColumns: "minmax(0, 1fr)", cursor: "default" }}><span className="bm-row__body"><span className="bm-row__title">{sample.title ?? sample.url}</span><span className="bm-row__meta">{sample.url}</span></span></span></li>
            ))}
          </ul>
        </div>
      ) : reading ? (
        <LoadingState label={reading} />
      ) : (
        <div className="ri-stack">
          <SegmentedControl label="Import from" value={mode} onChange={(value) => { setMode(value as Mode); setProblem(null); }} options={[{ id: "file", label: "File" }, { id: "paste", label: "Paste links" }]} />
          {mode === "file" ? (
            <div className="ri-stack ri-stack--tight">
              <p className="ri-small">Export bookmarks from your browser as HTML, or use Raindrop's HTML or CSV export. Any CSV with a url column works.</p>
              <div><Button onClick={() => void chooseFile()}>Choose a file</Button></div>
            </div>
          ) : (
            <TextArea label="Links" hint="Anything with web addresses in it" value={text} onChange={setText} rows={6} />
          )}
        </div>
      )}
      <InlineError>{problem}</InlineError>
    </Dialog>
  );
}
