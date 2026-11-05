/** @jsxRuntime automatic */
/** @jsxImportSource react */
/** One saved link: open it, edit what you wrote about it, and read what the page said. */
import { useEffect, useState } from "react";
import { AskRiButton, Button, ButtonRow, Dialog, ErrorState, InlineError, Inspector, KeyValueList, LoadingState, Notice, TextArea, TextInput, useAnnounce, useMutation, useQuery, useRiApp } from "@ri/app-kit/ui";
import type { BookmarkRecord } from "../schemas.js";
import { useNav } from "./app.js";
import { copyText, isHttps, parseTags, savedLabel, VIA_LABELS } from "./util.js";

interface Detail { bookmark: BookmarkRecord; pageText: string | null; pageTextTruncated: boolean; revision: string }
type UpdateResult = { status: "saved"; record: BookmarkRecord } | { status: "conflict"; current: BookmarkRecord; message: string };
type DeleteResult = { status: "deleted" } | { status: "conflict"; current: BookmarkRecord; message: string };

export function BookmarkInspector({ id, onClose, onChanged }: { id: string; onClose(): void; onChanged(change: { record?: BookmarkRecord; deleted?: string }): void }) {
  const app = useRiApp();
  const announce = useAnnounce();
  const { data } = useNav();
  const detail = useQuery<Detail>("get_bookmark", { id });
  const update = useMutation<Record<string, unknown>, UpdateResult>("update_bookmark");
  const remove = useMutation<Record<string, unknown>, DeleteResult>("delete_bookmark");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  // What the form was filled from. The difference is what the person has typed.
  const [base, setBase] = useState<{ revision: number; title: string; tags: string; note: string } | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  const bookmark = detail.data?.bookmark;
  const dirty = !!base && (title !== base.title || tags !== base.tags || note !== base.note);
  const fill = (record: BookmarkRecord) => {
    const next = { revision: record.revision, title: record.title, tags: record.tags.join(", "), note: record.note ?? "" };
    setBase(next);
    setTitle(next.title);
    setTags(next.tags);
    setNote(next.note);
  };
  // Fill the form when the record first arrives or moves on, and never over what is being typed.
  useEffect(() => {
    if (bookmark && !dirty && bookmark.revision !== base?.revision) fill(bookmark);
  }, [bookmark?.revision, dirty]);
  if (detail.error && !bookmark) return <ErrorState title="This link could not load" message={detail.error} onRetry={() => void detail.reload()} />;
  if (!bookmark || !base) return <LoadingState label="Loading link" />;
  const save = async () => {
    setConflict(null);
    const result = await update.run({ id, expectedRevision: base.revision, title, tags: parseTags(tags), note: note.trim() || null }).catch(() => null);
    update.reset();
    if (!result) return setConflict("This could not be saved. Try again.");
    if (result.status === "conflict") {
      // Keep what was typed, and let the next save go over the version now showing.
      setBase({ ...base, revision: result.current.revision });
      setConflict("This link changed while you were editing. Save again to keep your changes.");
      return void detail.reload();
    }
    fill(result.record);
    announce("Saved");
    await detail.reload();
    onChanged({ record: result.record });
  };
  const destroy = async () => {
    const result = await remove.run({ id, expectedRevision: bookmark.revision }).catch(() => null);
    remove.reset();
    setConfirming(false);
    if (result?.status === "deleted") {
      announce("Deleted");
      onChanged({ deleted: id });
      onClose();
    } else {
      setConflict(result?.message ?? "This could not be deleted. Try again.");
      void detail.reload();
    }
  };
  const copy = () => setCopied(copyText(bookmark.url));
  return (
    <Inspector
      title={bookmark.title}
      subtitle={bookmark.site}
      onClose={onClose}
      actions={
        <ButtonRow align="between">
          {data.owner ? <Button variant="quiet" onClick={() => setConfirming(true)}>Delete</Button> : <span />}
          <span className="ri-button-row">
            <AskRiButton prompt={`Using my bookmark "${bookmark.title.slice(0, 120)}", `} />
            {isHttps(bookmark.url) ? <Button variant="primary" onClick={() => void app.openExternal(bookmark.url)}>Open</Button> : <Button variant="primary" onClick={copy}>Copy link</Button>}
          </span>
        </ButtonRow>
      }
    >
      <div className="ri-stack">
        <div className="ri-stack ri-stack--tight">
          <p className="bm-link">{bookmark.url}</p>
          {!isHttps(bookmark.url) && <p className="ri-muted ri-small">This link isn't secure, so it opens from a copy rather than from here.</p>}
          {copied !== null && <p className="ri-muted ri-small" role="status">{copied ? "Copied" : "Select the link above and copy it"}</p>}
        </div>
        <KeyValueList items={[
          { label: "Saved", value: savedLabel(bookmark.savedAt) },
          { label: "From", value: VIA_LABELS[bookmark.via] ?? bookmark.via },
          { label: "Page", value: bookmark.page.label },
        ]} />
        {conflict && <Notice tone="warning" live>{conflict}</Notice>}
        <form className="ri-stack" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <TextInput label="Title" value={title} onChange={setTitle} maxLength={500} />
          <TextInput label="Tags" hint="Separate with commas" value={tags} onChange={setTags} />
          <TextArea label="Note" value={note} onChange={setNote} rows={3} maxLength={4000} />
          <InlineError>{update.error}</InlineError>
          {dirty && <div><Button type="submit" busy={update.pending} busyLabel="Saving">Save changes</Button></div>}
        </form>
        {detail.data?.pageText && (
          <section className="ri-stack ri-stack--tight" aria-label="Saved page text">
            <h3 className="ri-h3">What the page said</h3>
            <div className="bm-page-text" tabIndex={0}>{detail.data.pageText}</div>
            {detail.data.pageTextTruncated && <p className="ri-muted ri-small">Showing the first 40,000 characters.</p>}
          </section>
        )}
      </div>
      <Dialog
        open={confirming}
        title="Delete this link?"
        description="Its note, tags and saved page text go with it. This can't be undone."
        onClose={() => setConfirming(false)}
        busy={remove.pending}
        footer={<><Button variant="quiet" onClick={() => setConfirming(false)} disabled={remove.pending}>Keep</Button><Button variant="danger" busy={remove.pending} busyLabel="Deleting" onClick={() => void destroy()}>Delete</Button></>}
      />
    </Inspector>
  );
}
