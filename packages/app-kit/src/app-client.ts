import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
export interface AppClientCallbacks {
  result?: (data: unknown) => void;
  theme?: (theme: "light" | "dark") => void;
}
export async function connectApp(callbacks: AppClientCallbacks = {}) {
  const app = new App(
    { name: "Ri local app", version: "1.0.0" },
    {},
    { autoResize: false },
  );
  app.ontoolresult = (params) => {
    callbacks.result?.(params.structuredContent);
  };
  app.onhostcontextchanged = (context) => {
    if (context.theme) { document.documentElement.dataset.theme = context.theme; callbacks.theme?.(context.theme); }
  };
  await app.connect(new PostMessageTransport(window.parent, window.parent));
  const initialTheme = app.getHostContext()?.theme;
  if (initialTheme) {document.documentElement.dataset.theme = initialTheme; callbacks.theme?.(initialTheme);}
  let revision = 0;
  document.addEventListener("click", (event) => {
    const element = (event.target as Element).closest?.("[data-ri-link]");
    const url = element?.getAttribute("data-ri-link");
    if (url) {
      event.preventDefault();
      void app.openLink({ url });
    }
  });
  return {
    async selectFile() {
      const result = await app.callServerTool({name:'ri_select_file', arguments:{}});
      if(result.isError) throw new Error('File selection failed');
      return (result.structuredContent as {file:{name:string;mimeType:string;base64:string}|null}).file;
    },
    /**
     * Call an action this view was granted. Pass the same `invocationId` when
     * retrying a write so the app returns the original result instead of
     * applying it twice. Reads can omit it.
     */
    async call(action: string, input: Record<string, unknown> = {}, options: { invocationId?: string } = {}) {
      const result = await app.callServerTool({
        name: action,
        arguments: input,
        ...(options.invocationId ? { _meta: { "ri/invocationId": options.invocationId } } : {}),
      });
      if (result.isError)
        throw new Error(
          // Hosts prefix protocol errors with "MCP error -32603:". People see the app's own message.
          (result.content.find((item) => item.type === "text")?.text ??
            "App operation failed").replace(/^MCP error -?\d+:\s*/, ""),
        );
      return result.structuredContent;
    },
    async context(state: unknown) {
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
    },
    navigate(path: string) {
      return app.openLink({ url: path });
    },
    app,
  };
}
