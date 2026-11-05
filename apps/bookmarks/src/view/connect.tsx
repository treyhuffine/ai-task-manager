/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * How links get here from outside Ri. Each browser or phone gets its own key,
 * which can add links and nothing else, shown once and removable here.
 */
import { useEffect, useRef, useState } from "react";
import { AppShell, Button, ErrorState, InlineError, LoadingState, Notice, SectionPanel, TextInput, useAnnounce, useMutation, useQuery, useRiApp } from "@ri/app-kit/ui";
import type { Connections, NewConnection } from "../schemas.js";
import { MainTabs } from "./app.js";
import { copyText, errorMessage, savedLabel } from "./util.js";

function CopyField({ label, value, rows = 1 }: { label: string; value: string; rows?: number }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const area = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="bm-copy">
      <label className="ri-small" htmlFor={label}>{label}</label>
      <textarea id={label} ref={area} className="bm-code" readOnly rows={rows} value={value} onFocus={(event) => event.currentTarget.select()} />
      <div className="ri-button-row">
        <Button size="sm" onClick={() => { const copied = copyText(value); setState(copied ? "copied" : "failed"); if (!copied) area.current?.select(); }}>Copy</Button>
        <span className="ri-muted ri-small" role="status">{state === "copied" ? "Copied" : state === "failed" ? "Press Cmd+C to copy" : ""}</span>
      </div>
    </div>
  );
}

function Bookmarklet({ code }: { code: string }) {
  const link = useRef<HTMLAnchorElement>(null);
  // React refuses a script link in JSX, and this one is only ever dragged, never clicked here.
  useEffect(() => { link.current?.setAttribute("href", code); }, [code]);
  return <a ref={link} className="bm-bookmarklet" draggable onClick={(event) => event.preventDefault()}>Save to Ri</a>;
}

export function ConnectScreen() {
  const app = useRiApp();
  const announce = useAnnounce();
  const held = useQuery<Connections>("list_connections", {});
  const connect = useMutation<Record<string, unknown>, NewConnection>("connect_client");
  const disconnect = useMutation<Record<string, unknown>, { status: string }>("disconnect_client");
  const [name, setName] = useState("Chrome on my laptop");
  const [phone, setPhone] = useState("iPhone");
  const [made, setMade] = useState<{ for: "browser" | "phone"; connection: NewConnection } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const create = async (target: "browser" | "phone", label: string) => {
    setProblem(null);
    try {
      const connection = await connect.run({ name: label.trim() || (target === "phone" ? "Phone" : "Browser") });
      connect.reset();
      setMade({ for: target, connection });
      announce("Connection made");
      void held.reload();
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };
  const remove = async (id: string) => {
    setProblem(null);
    try {
      await disconnect.run({ id });
      disconnect.reset();
      if (made?.connection.connection.id === id) setMade(null);
      void held.reload();
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };
  const download = async () => {
    setDownloading(true);
    setProblem(null);
    try {
      const file = await app.call<{ fileName: string; base64: string }>("get_extension_package", {});
      await app.download({ name: file.fileName, mimeType: "application/zip", base64: file.base64 });
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setDownloading(false);
    }
  };
  const exportAll = async () => {
    setExporting(true);
    setProblem(null);
    try {
      const file = await app.call<{ fileName: string; text: string; truncated: boolean }>("export_bookmarks", {});
      await app.download({ name: file.fileName, mimeType: "text/html", text: file.text });
      if (file.truncated) setProblem("The library is too large for one file, so this export holds the newest links.");
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };
  const data = held.data;
  return (
    <AppShell eyebrow="Bookmarks" title="Connect" context="Save from your browser and your phone. Each gets a key that can add links and nothing else." tabs={<MainTabs value="connect" />}>
      <SectionPanel panelId="bm-main" value="connect">
        {held.error && !data ? (
          <ErrorState title="Connections could not load" message={held.error} onRetry={() => void held.reload()} />
        ) : !data ? (
          <LoadingState label="Loading connections" />
        ) : (
          <div className="ri-stack ri-stack--loose">
            <InlineError>{problem}</InlineError>
            <section className="bm-card" aria-labelledby="bm-extension">
              <h2 className="ri-h3" id="bm-extension">Browser extension</h2>
              <p className="ri-small">Works in Chrome, Brave, Edge and Arc. Bookmarks you make with Cmd+D come here on their own. Its button, or Alt+Shift+S, also saves the text of the page you can see, including behind a login.</p>
              {data.extensionStoreUrl ? (
                <div><Button onClick={() => void app.openExternal(data.extensionStoreUrl!)}>Add to Chrome</Button></div>
              ) : (
                <>
                  <ol className="bm-steps">
                    <li>Download the extension and unzip it.</li>
                    <li>Open <code>chrome://extensions</code> and turn on Developer mode.</li>
                    <li>Choose Load unpacked and pick the unzipped folder.</li>
                  </ol>
                  <div><Button busy={downloading} busyLabel="Preparing" onClick={() => void download()}>Download extension {data.extensionVersion}</Button></div>
                </>
              )}
              <div className="ri-stack ri-stack--tight">
                <TextInput label="Name this browser" value={name} onChange={setName} maxLength={80} />
                <div><Button variant="primary" busy={connect.pending} busyLabel="Making" onClick={() => void create("browser", name)}>Make a connection code</Button></div>
              </div>
              {made?.for === "browser" && (
                <div className="ri-stack ri-stack--tight">
                  <Notice tone="success" title="Paste this into the extension's options." live>It is shown once. If you lose it, make another and remove this one.</Notice>
                  <CopyField label="Connection code" value={made.connection.code} rows={4} />
                </div>
              )}
            </section>

            <section className="bm-card" aria-labelledby="bm-phone">
              <h2 className="ri-h3" id="bm-phone">iPhone Shortcut</h2>
              <p className="ri-small">Adds Save to Ri to your share sheet. In the Shortcuts app, make a new shortcut that receives URLs from the share sheet, with one action:</p>
              <ol className="bm-steps">
                <li>Add Get Contents of URL and set the URL below.</li>
                <li>Set Method to POST, add the header below, and set Request Body to JSON with one field: <code>url</code>, set to Shortcut Input.</li>
              </ol>
              <div className="ri-stack ri-stack--tight">
                <TextInput label="Name this phone" value={phone} onChange={setPhone} maxLength={80} />
                <div><Button busy={connect.pending} busyLabel="Making" onClick={() => void create("phone", phone)}>Make a key</Button></div>
              </div>
              {made?.for === "phone" && (
                <div className="ri-stack ri-stack--tight">
                  <Notice tone="success" title="Use these in the shortcut." live>The key is shown once.</Notice>
                  <CopyField label="URL" value={made.connection.saveUrl} />
                  <CopyField label="Authorization header" value={`Bearer ${made.connection.key}`} rows={2} />
                </div>
              )}
            </section>

            <section className="bm-card" aria-labelledby="bm-bookmarklet">
              <h2 className="ri-h3" id="bm-bookmarklet">Bookmarklet</h2>
              <p className="ri-small">For Safari, Firefox or any browser signed in to this Ri. Drag this to your bookmarks bar, then click it on any page.</p>
              <div><Bookmarklet code={data.bookmarklet} /></div>
              <CopyField label="Or copy it into a new bookmark's address" value={data.bookmarklet} rows={3} />
            </section>

            <section className="ri-stack ri-stack--tight" aria-labelledby="bm-connected">
              <h2 className="ri-h3" id="bm-connected">Connected</h2>
              {data.connections.length ? (
                <ul className="bm-connections">
                  {data.connections.map((item) => (
                    <li key={item.id}>
                      <span className="ri-stack ri-stack--tight" style={{ gap: 0 }}>
                        <span>{item.name}</span>
                        <span className="ri-muted ri-small">{item.lastUsedAt ? `Last used ${savedLabel(item.lastUsedAt)}` : `Made ${savedLabel(item.createdAt)}, not used yet`}</span>
                      </span>
                      <Button size="sm" variant="quiet" aria-label={`Remove ${item.name}`} onClick={() => void remove(item.id)}>Remove</Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ri-muted ri-small">Nothing is connected yet.</p>
              )}
            </section>

            <section className="ri-stack ri-stack--tight" aria-labelledby="bm-export">
              <h2 className="ri-h3" id="bm-export">Your links</h2>
              <p className="ri-small ri-muted">Export a bookmarks file that any browser or bookmark service can import.</p>
              <div><Button busy={exporting} busyLabel="Exporting" onClick={() => void exportAll()}>Export bookmarks</Button></div>
            </section>
          </div>
        )}
      </SectionPanel>
    </AppShell>
  );
}
