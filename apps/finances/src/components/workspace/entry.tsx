import { createRoot } from "react-dom/client";
import { Component, type ReactNode } from "react";
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-with-deps";
import { Workspace } from "./workspace";
import type { FinanceClient, Home } from "./types";
import "./workspace.css";

const root = createRoot(document.getElementById("root")!);
const app = new App(
  { name: "Finances", version: "0.1.0" },
  {},
  { autoResize: false },
);
let revision = 0;
let tail: Promise<unknown> = Promise.resolve();
function queue<T>(operation: () => Promise<T>): Promise<T> {
  const result = tail.then(operation);
  tail = result.catch(() => {});
  return result;
}
const client: FinanceClient = {
  call: <T,>(name: string, input: Record<string, unknown> = {}) =>
    queue(async () => {
      const result = await app.callServerTool({ name, arguments: input });
      if (result.isError)
        throw new Error(
          result.content.find((c) => c.type === "text")?.text ??
            "This action could not finish.",
        );
      return result.structuredContent as T;
    }),
  context: (state) =>
    queue(async () => {
      await app.updateModelContext({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              formatVersion: 1,
              revision: ++revision,
              state,
            }),
          },
        ],
      });
    }),
  navigate: (path) => app.openLink({ url: path }),
  selectFile: async () =>
    (
      await client.call<{
        file: { name: string; mimeType: string; base64: string } | null;
      }>("ri_select_file")
    ).file,
  download: async (text, name, mimeType) => {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > 512 * 1024)
      throw new Error(
        "This export is too large. Choose a shorter period or one account.",
      );
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    await app.downloadFile({
      contents: [
        {
          type: "resource",
          resource: { uri: name, mimeType, blob: btoa(binary) },
        },
      ],
    });
  },
};
class RenderGuard extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="opening" role="alert">
        <h2>This view could not be displayed.</h2>
        <p>Your records are kept in Finances.</p>
        <button
          className="button"
          onClick={() =>
            void client
              .call<Home>("finance_home")
              .then((data) => {
                renderData(data);
                this.setState({ error: false });
              })
              .catch(() => this.setState({ error: true }))
          }
        >
          Try opening it again
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function renderData(data: Home) {
  root.render(
    <RenderGuard>
      <Workspace home={data} client={client} />
    </RenderGuard>,
  );
}
app.ontoolresult = (result) => {
  const data = result.structuredContent as Home | undefined;
  if (data && Array.isArray(data.accounts)) renderData(data);
};
app.onhostcontextchanged = (context) => {
  if (context.theme) document.documentElement.dataset.theme = context.theme;
};
root.render(
  <div className="opening" role="status">
    Opening Finances…
  </div>,
);
void app
  .connect(new PostMessageTransport(window.parent, window.parent))
  .then(() => {
    document.documentElement.dataset.theme =
      app.getHostContext()?.theme ?? "light";
  })
  .catch((error) =>
    root.render(
      <div role="alert" className="opening">
        Finances could not connect. {String(error.message)}
      </div>,
    ),
  );
