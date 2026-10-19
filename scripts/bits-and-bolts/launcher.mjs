// Bits & Bolts on its local store, served over Streamable HTTP for hosts that connect by URL.
//
// `pnpm bits-and-bolts` bundles this file against a pinned checkout of openai/mcp-extensions
// (`BNB` resolves to plugins/bits-and-bolts) and writes the bundle to that plugin's `.ri/` folder,
// so the catalog's `../assets/models` and this file's `../dist` resolve inside the plugin.
//
// It mirrors the plugin's own stdio entry point (src/server/index.ts): the same registerCadServer,
// local catalog, form helper and app HTML, with no remote assets, so its screens are self-contained.
// One handler serves MCP 2026-07-28 and 2025-era clients. Loopback only, no authentication.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { registerCadServer, cadImportSchema, cadResult } from "BNB/src/server/register.js";
import { elicitCadForm } from "BNB/src/server/forms.js";
import { createLocalStore } from "BNB/src/server/local-store.js";

const plugin = new URL("../", import.meta.url);
const iconSvg = async (theme) =>
  "data:image/svg+xml," + encodeURIComponent(await readFile(new URL(`assets/icon${theme === "dark" ? "-dark" : ""}.svg`, plugin), "utf8"));
const icons = [
  { src: await iconSvg("light"), mimeType: "image/svg+xml", sizes: ["any"], theme: "light" },
  { src: await iconSvg("dark"), mimeType: "image/svg+xml", sizes: ["any"], theme: "dark" },
];
const html = await readFile(new URL("dist/app.html", plugin), "utf8");
const wasm = { blob: (await readFile(new URL("dist/occt-import-js.wasm", plugin))).toString("base64") };
const store = await createLocalStore();

const mcp = createMcpHandler(async () => {
  const server = new McpServer({ name: "bits-and-bolts", title: "Bits & Bolts", version: "0.1.0", icons });
  server.registerTool("cad.importPart", {
    title: "Add CAD file",
    inputSchema: cadImportSchema.extend({ blob: z.string() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ["app"] } },
  }, async (input) => cadResult({ part: await store.import(input) }));
  registerCadServer({
    server, partUriTemplate: "mcp://bits-and-bolts/parts/{id}", store, html, icons,
    formats: ["stl", "3mf", "step", "stp"], wasm,
    elicit: (context, params) => elicitCadForm(server, context, params),
  });
  return server;
}, { legacy: "stateless", maxRequestBodySize: 64 * 1024 * 1024 });

const port = Number(process.env.PORT ?? 3917);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `127.0.0.1:${port}`}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Bits & Bolts serves MCP at /mcp\n");
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    const body = ["GET", "HEAD"].includes(req.method ?? "GET") ? {} : { body: Readable.toWeb(req), duplex: "half" };
    const response = await mcp.fetch(new Request(url, { method: req.method, headers, ...body }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) await pipeline(Readable.fromWeb(response.body), res);
    else res.end();
  } catch (error) {
    console.error(new Date().toISOString(), "request failed:", error instanceof Error ? error.message : error);
    if (res.headersSent) res.destroy();
    else { res.writeHead(500); res.end(); }
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(`${new Date().toISOString()} Bits & Bolts at http://localhost:${port}/mcp (library ${process.env.CAD_LIBRARY_HOME})`);
});
const shutdown = () => {
  console.log(`${new Date().toISOString()} stopping`);
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
