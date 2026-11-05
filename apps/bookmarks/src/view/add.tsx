/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { Button, Dialog, InlineError, TextArea, TextInput, useMutation } from "@ri/app-kit/ui";
import { errorMessage, parseTags } from "./util.js";

export function AddDialog({ open, onClose, onSaved }: { open: boolean; onClose(): void; onSaved(id: string): void }) {
  const save = useMutation<Record<string, unknown>, { record: { id: string } }>("save_bookmark");
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setUrl(""); setTags(""); setNote(""); setProblem(null); save.reset(); }
  }, [open]);
  const submit = async () => {
    const value = url.trim();
    if (!value) return setProblem("Paste a link");
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
    setProblem(null);
    try {
      const result = await save.run({ url: withScheme, tags: parseTags(tags), note: note.trim() || null, via: "added" });
      save.reset();
      onSaved(result.record.id);
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };
  return (
    <Dialog
      open={open}
      title="Add a link"
      onClose={onClose}
      busy={save.pending}
      footer={<><Button variant="quiet" onClick={onClose} disabled={save.pending}>Cancel</Button><Button variant="primary" busy={save.pending} busyLabel="Saving" onClick={() => void submit()}>Save</Button></>}
    >
      <TextInput label="Link" value={url} onChange={setUrl} required maxLength={4000} placeholder="https://" autoFocus />
      <TextInput label="Tags" hint="Optional. Separate with commas" value={tags} onChange={setTags} />
      <TextArea label="Note" hint="Optional" value={note} onChange={setNote} rows={2} maxLength={4000} />
      <InlineError>{problem}</InlineError>
    </Dialog>
  );
}
