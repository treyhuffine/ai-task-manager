/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * What the bookmarklet opens: it saves the link straight away, then lets the
 * person add tags or a note. A repeat merges, so a reload changes nothing.
 */
import { useEffect, useRef, useState } from "react";
import { AppShell, Button, ErrorState, LoadingState, Notice, TextArea, TextInput, useAnnounce, useMutation } from "@ri/app-kit/ui";
import type { BookmarkRecord } from "../schemas.js";
import { useNav } from "./app.js";
import { errorMessage, parseTags } from "./util.js";

export function SaveScreen() {
  const { data, navigate } = useNav();
  const announce = useAnnounce();
  const save = useMutation<Record<string, unknown>, { created: boolean; record: BookmarkRecord }>("save_bookmark");
  const update = useMutation<Record<string, unknown>, { status: "saved" } | { status: "conflict"; current: BookmarkRecord }>("update_bookmark");
  const [record, setRecord] = useState<BookmarkRecord | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const started = useRef(false);
  const link = data.save;
  useEffect(() => {
    if (!link || started.current) return;
    started.current = true;
    save.run({ url: link.url, title: link.title, via: "bookmarklet" }).then((result) => {
      save.reset();
      setRecord(result.record);
      setTags(result.record.tags.join(", "));
      setNote(result.record.note ?? link.note ?? "");
      announce("Saved");
    }, (error) => setProblem(errorMessage(error)));
  }, [link?.url]);
  const finish = async () => {
    if (!record) return;
    if (tags.trim() || note.trim()) {
      const send = async (expectedRevision: number) => {
        const result = await update.run({ id: record.id, expectedRevision, tags: parseTags(tags), note: note.trim() || null });
        update.reset();
        return result;
      };
      try {
        // Only moments have passed, so what was just typed wins over a change made meanwhile.
        const first = await send(record.revision);
        if (first.status === "conflict" && (await send(first.current.revision)).status === "conflict") return setProblem("This link keeps changing. Add your tags from Bookmarks.");
      } catch (error) {
        return setProblem(errorMessage(error));
      }
    }
    setDone(true);
  };
  return (
    <AppShell eyebrow="Bookmarks" title="Save a link" className="bm-save">
      {problem ? (
        <ErrorState title="This link could not be saved" message={problem} />
      ) : !record ? (
        <LoadingState label="Saving" />
      ) : done ? (
        <div className="ri-stack">
          <Notice tone="success" title="Saved." live>You can close this window.</Notice>
          <div><Button onClick={() => navigate({ section: "list", bookmarkId: record.id, query: "", tag: "" })}>See it in Bookmarks</Button></div>
        </div>
      ) : (
        <div className="bm-card">
          <Notice tone="success" title="Saved." live>{record.title}</Notice>
          <p className="bm-link">{record.url}</p>
          <TextInput label="Tags" hint="Optional. Separate with commas" value={tags} onChange={setTags} />
          <TextArea label="Note" hint="Optional" value={note} onChange={setNote} rows={3} maxLength={4000} />
          <div><Button variant="primary" busy={update.pending} busyLabel="Saving" onClick={() => void finish()}>Done</Button></div>
        </div>
      )}
    </AppShell>
  );
}
