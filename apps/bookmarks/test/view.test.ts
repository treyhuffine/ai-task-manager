/**
 * Packaged view qualification. Imports the real catalog archive, runs its
 * packaged server through AppEngine, and drives the packaged dist/ui.html in
 * real Chromium through AppViewController, the same opaque relay Ri uses.
 * Screenshots go to artifacts/ for review. Requires
 * `pnpm --filter ri-bookmarks package` first. All data is fictional.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { chromium, type Browser, type Frame, type Page } from "playwright-core";
import { AppError, publicError, type AppPrincipal } from "@ri/app-kit/contract";
import { AppEngine, NativeNodeDriver, type HostServices, type InstalledArtifact } from "@ri/app-kit/runtime";
import { importPackage, prepareHtml } from "@ri/app-kit/build";

const root = path.resolve(import.meta.dirname, "..");
const repository = path.resolve(root, "../..");
const archive = path.join(repository, "release/local-apps/dev-catalog/ri-bookmarks.tar.gz");
const artifacts = path.join(root, "artifacts");

type Principal = "owner" | "fixture";
const PRINCIPALS: Record<Principal, AppPrincipal> = { owner: { kind: "owner-ui", id: "owner" }, fixture: { kind: "fixture", id: "preview", fixtureAudience: "user" } };
interface World { engine: AppEngine; instance: InstalledArtifact; keys: { id: string; name: string; createdAt: string; lastUsedAt: string | null }[] }

const temporary: string[] = [];
let browser: Browser;
let server: http.Server;
let origin: string;
let hostScript: string;
const worlds = new Map<string, World>();
const writes = new Set<string>();

async function createWorld(name: string): Promise<World> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ri-bookmarks-view-"));
  temporary.push(dir);
  const artifact = await importPackage(archive, path.join(dir, "package"));
  for (const action of artifact.contract.actions) if (action.effect !== "read") writes.add(action.name);
  const instance: InstalledArtifact = { ...artifact, instanceId: randomUUID(), dataDir: path.join(dir, "data"), cacheDir: path.join(dir, "cache"), logsDir: path.join(dir, "logs") };
  for (const folder of [instance.dataDir, instance.cacheDir, instance.logsDir]) fs.mkdirSync(folder, { recursive: true });
  const world = { keys: [] } as unknown as World;
  const address = { homeUrl: "https://home.example", appUrl: "https://home.example/apps/bookmarks" };
  const services: HostServices = {
    version: 1,
    authorize(_instance, _action, context) { if (!["owner-ui", "fixture"].includes(context.principal.kind)) throw new AppError("forbidden", "Not in this test"); },
    invocationAccess: (_instance, context) => ({ protocol: "ri-access-v1", actorId: `${context.principal.kind}:${context.principal.id}`, scopeRef: null, accounts: [] }),
    async capability(_instance, _context, call) {
      if (call.name === "list_client_keys") return { keys: world.keys, ...address };
      if (call.name === "create_client_key") {
        const key = { id: randomUUID(), name: String((call.input as { name: string }).name), createdAt: new Date().toISOString(), lastUsedAt: null };
        world.keys.push(key);
        return { key, token: "ri_live_fictional", ...address };
      }
      if (call.name === "revoke_client_key") { world.keys = world.keys.filter((key) => key.id !== (call.input as { id: string }).id); return { revoked: true }; }
      throw new AppError("forbidden", `Not in this test: ${call.name}`);
    },
    event() {},
  };
  world.engine = new AppEngine(services, new NativeNodeDriver(process.execPath));
  world.instance = instance;
  worlds.set(name, world);
  return world;
}
function body(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => { try { resolve(JSON.parse(text || "{}")); } catch (error) { reject(error); } });
  });
}
function locationQuery(location: string) {
  const [pathname, search] = location.split("?");
  return { path: pathname, query: Object.fromEntries(new URLSearchParams(search ?? "")) };
}

beforeAll(async () => {
  if (!fs.existsSync(archive)) throw new Error("Run pnpm --filter ri-bookmarks package first");
  fs.mkdirSync(artifacts, { recursive: true });
  const require = createRequire(import.meta.url);
  const compiled = await build({
    stdin: { contents: `import {AppViewController} from ${JSON.stringify(require.resolve("@ri/app-kit/view-host"))};window.AppViewController=AppViewController;`, resolveDir: root },
    bundle: true, write: false, format: "iife", platform: "browser", target: "es2023", logLevel: "silent",
  });
  hostScript = compiled.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#888}#mount{width:100%;height:100vh}</style></head><body><div id="mount"></div><script>${hostScript}</script><script>
    window.__state={links:[],contexts:[],errors:[],calls:[],downloads:[],location:'/'};
    window.startView=async(guest,binding,world,principal)=>{
      const state=window.__state;
      const controller=new AppViewController(document.getElementById('mount'),{
        call:async(action,input,signal,meta)=>{
          state.calls.push(action);
          const response=await fetch('/call',{method:'POST',body:JSON.stringify({world,principal,action,input,invocationId:meta&&meta.invocationId,opened:state.opened})});
          const reply=await response.json();
          if(reply.error)throw new Error(reply.error.message);
          if(reply.refresh)setTimeout(()=>controller.refresh(reply.refresh),10);
          return reply.result;
        },
        context:async(envelope)=>{state.contexts.push(envelope);},
        navigate:(path)=>{state.links.push(path);if(path.startsWith('/__host/location?')){const to=new URL(path,'https://app.invalid').searchParams.get('to');if(to)state.location=to;}},
        externalLink:(url)=>{state.links.push(url);},
        error:(error)=>{state.errors.push(error.message);},
        selectFile:async()=>window.__file||null,
        downloadFile:async(contents)=>{state.downloads.push(contents);},
      });
      window.controller=controller;
      await controller.open(guest,binding);
    };
  </script></body></html>`;
  server = http.createServer(async (request, response) => {
    if (request.method === "GET") { response.setHeader("Content-Type", "text/html"); response.end(page); return; }
    const input = await body(request);
    const world = worlds.get(String(input.world))!;
    const principal = PRINCIPALS[input.principal as Principal];
    try {
      const result = await world.engine.invoke(world.instance, String(input.action), input.input, principal, 0, typeof input.invocationId === "string" ? input.invocationId : undefined);
      let refresh: unknown = null;
      if (writes.has(String(input.action))) refresh = ((await world.engine.invoke(world.instance, "open_view", locationQuery(String(input.opened ?? "/")), principal, 0)) as { data: unknown }).data;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ result, refresh }));
    } catch (error) {
      response.end(JSON.stringify({ error: publicError(error) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // The bundled Chromium, with the flag that keeps nested sandboxed frames visible to automation.
  browser = await chromium.launch({ headless: true, args: ["--disable-features=IsolateSandboxedIframes"], env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR } });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await Promise.all([...worlds.values()].map((world) => world.engine.stop(world.instance.instanceId).catch(() => undefined)));
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}, 60_000);

async function open(world: World, name: string, principal: Principal, location: string, size: { width: number; height: number }, theme: "light" | "dark" = "light") {
  const page = await browser.newPage({ viewport: size });
  page.setDefaultTimeout(15_000);
  const external: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => { if (!request.url().startsWith(origin) && !request.url().startsWith("data:") && request.url() !== "about:srcdoc") external.push(request.url()); });
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto(origin);
  const opened = (await world.engine.invoke(world.instance, "open_view", locationQuery(location), PRINCIPALS[principal], 0)) as { data: unknown };
  const guest = prepareHtml(fs.readFileSync(path.join(world.instance.packageDir, "dist/ui.html"), "utf8"));
  await page.evaluate(([value]) => { const target = (window as unknown as { __state: { location: string; opened: string } }).__state; target.location = value; target.opened = value; }, [location]);
  await page.evaluate(async ({ guest, binding, name, principal }) => {
    await (window as unknown as { startView(guest: unknown, binding: unknown, world: string, principal: string): Promise<void> }).startView(guest, binding, name, principal);
  }, { guest, binding: { id: randomUUID(), packageDigest: world.instance.digest, initialData: opened.data, path: locationQuery(location).path, query: locationQuery(location).query, theme, files: world.instance.manifest.extensions["com.ri"].requests.files, resource: "ui://ri-bookmarks/main.html" }, name, principal });
  let frame: Frame | undefined;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    frame = page.frames().find((item) => item.parentFrame() && item.parentFrame() !== page.mainFrame());
    if (frame && (await frame.locator("#root > *").count().catch(() => 0)) > 0) break;
    await page.waitForTimeout(100);
  }
  if (!frame || (await frame.locator("#root > *").count().catch(() => 0)) === 0) throw new Error(`The view did not render: ${JSON.stringify(consoleErrors)}`);
  return { page, frame, external, consoleErrors };
}
const state = (page: Page) => page.evaluate(() => (window as unknown as { __state: { links: string[]; contexts: { state: Record<string, unknown> }[]; errors: string[]; calls: string[]; downloads: { resource: { uri: string; mimeType: string; text?: string; blob?: string } }[][]; location: string } }).__state);
async function shot(page: Page, file: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(artifacts, file) });
}
async function noOverflow(frame: Frame) {
  const widths = await frame.locator("html").evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
}
const visible = (frame: Frame, text: string | RegExp) => frame.getByText(text).locator("visible=true");

describe("packaged Bookmarks view", () => {
  it("searches a fictional library by what pages said, opens a link and hands context to the chat", async () => {
    const world = await createWorld("preview");
    const { page, frame, external, consoleErrors } = await open(world, "preview", "fixture", "/", { width: 1280, height: 900 });
    await expect.poll(() => visible(frame, "Tide tables for small harbors").count()).toBeGreaterThan(0);
    await expect.poll(() => visible(frame, "Fictional preview.").count()).toBe(1);
    await noOverflow(frame);
    await shot(page, "bookmarks-1280-list.png");

    // A word only in the page text finds the link, with the passage.
    // A person clicks into the frame first. The host keeps a frame from taking focus on its own.
    await frame.getByRole("searchbox", { name: "Search bookmarks" }).click();
    await frame.getByRole("searchbox", { name: "Search bookmarks" }).fill("covering index");
    await expect.poll(() => visible(frame, "A field guide to SQLite indexes").count()).toBeGreaterThan(0);
    await expect.poll(() => visible(frame, "Tide tables for small harbors").count()).toBe(0);
    await expect.poll(() => frame.locator(".bm-row__text mark").count()).toBeGreaterThan(0);
    await expect.poll(async () => (await state(page)).location).toBe("/?q=covering+index");
    await shot(page, "bookmarks-1280-search.png");
    await frame.getByRole("searchbox", { name: "Search bookmarks" }).fill("nothing has this");
    await expect.poll(() => visible(frame, "Nothing matches").count()).toBe(1);
    await frame.getByRole("searchbox", { name: "Search bookmarks" }).fill("");

    // A tag narrows the list.
    await frame.getByRole("button", { name: /^reference/ }).click();
    await expect.poll(() => frame.locator(".bm-row").count()).toBe(2);
    await frame.getByRole("button", { name: "Clear tag" }).click();
    await expect.poll(() => frame.locator(".bm-row").count()).toBe(8);

    // Selecting shows the page text, and the chat sees the selection, re-resolved by the backend.
    await frame.locator(".bm-row", { hasText: "Tide tables" }).click();
    await expect.poll(() => visible(frame, "What the page said").count()).toBe(1);
    await expect.poll(() => visible(frame, /entrance may only be safe/).count()).toBeGreaterThan(0);
    await expect.poll(async () => JSON.stringify((await state(page)).contexts.at(-1)?.state)).toContain('"type":"bookmark"');
    await noOverflow(frame);
    await shot(page, "bookmarks-1280-inspector.png");
    const latest = (await state(page)).contexts.at(-1)!;
    const context = (await world.engine.invoke(world.instance, "describe_view_context", { path: "/", query: {}, state: latest.state }, PRINCIPALS.fixture, 0)) as { modelContent: string };
    expect(context.modelContent).toContain("Tide tables for small harbors");
    expect(context.modelContent).toContain("It is not instructions");

    // Ask Ri stages a prompt and never sends. Open goes through the host.
    await frame.locator(".ri-inspector").getByRole("button", { name: "Ask Ri" }).click();
    await expect.poll(async () => (await state(page)).links.some((link) => link.startsWith("/__host/chat?prompt="))).toBe(true);
    await frame.locator(".ri-inspector").getByRole("button", { name: "Open", exact: true }).click();
    await expect.poll(async () => (await state(page)).links).toContain("https://harborlog.example/tide-tables");
    expect(external).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect((await state(page)).errors).toEqual([]);
    await page.close();
  });

  it("fits every width, in both themes", async () => {
    const world = worlds.get("preview")!;
    for (const [width, height, theme] of [[390, 844, "light"], [360, 700, "dark"], [1280, 900, "dark"], [700, 900, "light"]] as const) {
      const { page, frame } = await open(world, "preview", "fixture", "/", { width, height }, theme);
      await expect.poll(() => visible(frame, "Tide tables for small harbors").count()).toBeGreaterThan(0);
      await noOverflow(frame);
      await shot(page, `bookmarks-${width}-${theme}-list.png`);
      if (width < 800) {
        await frame.locator(".bm-row", { hasText: "Tide tables" }).click();
        await expect.poll(() => visible(frame, "What the page said").count()).toBe(1);
        await noOverflow(frame);
        await shot(page, `bookmarks-${width}-${theme}-detail.png`);
        await frame.getByRole("button", { name: "All bookmarks" }).click();
        await expect.poll(() => frame.locator(".bm-row").count()).toBe(8);
      }
      await frame.getByRole("tab", { name: "Connect" }).click();
      await expect.poll(() => visible(frame, "Browser extension").count()).toBeGreaterThan(0);
      await noOverflow(frame);
      await shot(page, `bookmarks-${width}-${theme}-connect.png`);
      await page.close();
    }
  });

  it("starts empty, saves a link, says reading is off, edits and deletes", async () => {
    const world = await createWorld("owner");
    const { page, frame, consoleErrors } = await open(world, "owner", "owner", "/", { width: 1280, height: 900 });
    await expect.poll(() => visible(frame, "Save your first link").count()).toBe(1);
    await shot(page, "bookmarks-1280-empty.png");
    await frame.getByRole("button", { name: "Add link" }).click();
    await frame.getByRole("textbox", { name: /Link/ }).fill("example.test/harbor");
    await frame.getByRole("textbox", { name: /Tags/ }).fill("Boats, Planning");
    await frame.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect.poll(() => visible(frame, "Waiting to be read").count()).toBe(1);
    await expect.poll(() => visible(frame, "Search only covers titles and links for now.").count()).toBe(1);
    await frame.getByRole("button", { name: "Turn on reading" }).click();
    await expect.poll(async () => (await state(page)).links.some((link) => link.startsWith("/__host/sources"))).toBe(true);
    const inspector = frame.locator(".ri-inspector");
    await inspector.getByRole("textbox", { name: "Title" }).fill("Harbor notes");
    await inspector.getByRole("textbox", { name: "Note" }).fill("Mine");
    await inspector.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => frame.locator(".bm-row__title").first().textContent()).toBe("Harbor notes");
    await expect.poll(() => inspector.getByRole("button", { name: "Save changes" }).count()).toBe(0);
    await shot(page, "bookmarks-1280-saved.png");
    await inspector.getByRole("button", { name: "Delete" }).click();
    await shot(page, "bookmarks-1280-delete.png");
    await frame.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => visible(frame, "Save your first link").count()).toBe(1);
    expect(consoleErrors).toEqual([]);
    await page.close();
  });

  it("never overwrites what someone is typing, and keeps it through a conflict", async () => {
    const world = await createWorld("typing");
    const { record } = (await world.engine.invoke(world.instance, "save_bookmark", { url: "https://example.test/typing", title: "Original" }, PRINCIPALS.owner, 0)) as { record: { id: string; revision: number } };
    const { page, frame } = await open(world, "typing", "owner", `/bookmarks/${record.id}`, { width: 1280, height: 900 });
    const inspector = frame.locator(".ri-inspector");
    const note = inspector.getByRole("textbox", { name: "Note" });
    await note.click();
    await note.fill("Half typed");
    // The record changes elsewhere, and the host refreshes the view.
    await world.engine.invoke(world.instance, "update_bookmark", { id: record.id, expectedRevision: record.revision, title: "Changed elsewhere" }, PRINCIPALS.owner, 0);
    const opened = (await world.engine.invoke(world.instance, "open_view", { path: `/bookmarks/${record.id}`, query: {} }, PRINCIPALS.owner, 0)) as { data: unknown };
    await page.evaluate((data) => (window as unknown as { controller: { refresh(value: unknown): void } }).controller.refresh(data), opened.data);
    await expect.poll(() => frame.locator(".ri-inspector__title").textContent()).toBe("Changed elsewhere");
    expect(await note.inputValue()).toBe("Half typed");
    await inspector.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => visible(frame, /changed while you were editing/).count()).toBeGreaterThan(0);
    expect(await note.inputValue()).toBe("Half typed");
    await inspector.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => inspector.getByRole("button", { name: "Save changes" }).count()).toBe(0);
    const saved = (await world.engine.invoke(world.instance, "get_bookmark", { id: record.id }, PRINCIPALS.owner, 0)) as { bookmark: { note: string } };
    expect(saved.bookmark.note).toBe("Half typed");
    await page.close();
  });

  it("imports a large browser export in parts, with a preview first", async () => {
    const world = await createWorld("import");
    const { page, frame } = await open(world, "import", "owner", "/", { width: 1280, height: 900 });
    // About 6 MB, nearly all inline favicons, like a real browser export. Far over one action's input limit.
    const icon = "A".repeat(3000);
    const rows = Array.from({ length: 2000 }, (_, index) => `<DT><A HREF="https://site${index}.example/page" ADD_DATE="${1600000000 + index}" ICON="data:image/png;base64,${icon}">Page ${index}</A>`);
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>Bookmarks bar</H3><DL><DT><H3>Sailing</H3><DL>${rows.join("\n")}</DL></DL></DL>`;
    await page.evaluate((text) => { (window as unknown as { __file: unknown }).__file = { name: "bookmarks.html", mimeType: "text/html", base64: btoa(text) }; }, html);
    await frame.getByRole("button", { name: "Import bookmarks" }).click();
    await frame.getByRole("button", { name: "Choose a file" }).click();
    await expect.poll(() => visible(frame, "already saved").count(), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => frame.locator(".bm-counts").textContent()).toContain("2,000 new");
    await shot(page, "bookmarks-1280-import-preview.png");
    await frame.getByRole("dialog").getByRole("button", { name: "Import 2,000 links" }).click();
    await expect.poll(() => visible(frame, "Imported 2,000 new links.").count(), { timeout: 30_000 }).toBeGreaterThan(0);
    await shot(page, "bookmarks-1280-import-done.png");
    await frame.getByRole("button", { name: "Done" }).click();
    await expect.poll(() => frame.locator(".bm-row").count()).toBe(50);
    await frame.getByRole("button", { name: "Show more" }).click();
    await expect.poll(() => frame.locator(".bm-row").count()).toBe(100);
    await expect.poll(() => visible(frame, /^sailing/).count()).toBeGreaterThan(0);
    // A link arriving from outside doesn't collapse what has been opened.
    await world.engine.invoke(world.instance, "save_bookmark", { url: "https://example.test/arrived", title: "Arrived" }, PRINCIPALS.owner, 0);
    const opened = (await world.engine.invoke(world.instance, "open_view", { path: "/", query: {} }, PRINCIPALS.owner, 0)) as { data: unknown };
    await page.evaluate((data) => (window as unknown as { controller: { refresh(value: unknown): void } }).controller.refresh(data), opened.data);
    await expect.poll(() => visible(frame, "Arrived").count()).toBeGreaterThan(0);
    expect(await frame.locator(".bm-row").count()).toBeGreaterThanOrEqual(100);
    await page.close();
  }, 120_000);

  it("takes pasted links and explains a file it can't use", async () => {
    const world = await createWorld("paste");
    const { page, frame } = await open(world, "paste", "owner", "/", { width: 1280, height: 900 });
    await frame.getByRole("button", { name: "Import bookmarks" }).click();
    await page.evaluate(() => { (window as unknown as { __file: unknown }).__file = { name: "notes.txt", mimeType: "text/plain", base64: btoa("just some notes") }; });
    await frame.getByRole("button", { name: "Choose a file" }).click();
    await expect.poll(() => visible(frame, /No links were found/).count()).toBeGreaterThan(0);
    await frame.getByRole("radio", { name: "Paste links" }).click();
    await frame.getByRole("textbox", { name: /Links/ }).fill("read https://example.test/one and https://example.test/two");
    await frame.getByRole("button", { name: "Continue" }).click();
    await expect.poll(() => frame.locator(".bm-counts").textContent()).toContain("2 new");
    await page.close();
  });

  it("connects a browser and a phone, offers the extension, bookmarklet and export, and removes a connection", async () => {
    const world = await createWorld("connect");
    await world.engine.invoke(world.instance, "save_bookmark", { url: "https://example.test/harbor", title: "Harbor" }, PRINCIPALS.owner, 0);
    const { page, frame, consoleErrors } = await open(world, "connect", "owner", "/connect", { width: 1280, height: 1100 });
    await expect.poll(() => visible(frame, "Nothing is connected yet.").count()).toBe(1);
    await shot(page, "bookmarks-1280-connect.png");

    await frame.getByRole("button", { name: "Make a connection code" }).click();
    const code = frame.getByRole("textbox", { name: "Connection code" });
    await expect.poll(async () => (await code.inputValue()).startsWith("ri-bookmarks:")).toBe(true);
    expect(JSON.parse(Buffer.from((await code.inputValue()).slice("ri-bookmarks:".length), "base64url").toString())).toEqual({ v: 1, home: "https://home.example", app: "https://home.example/apps/bookmarks", key: "ri_live_fictional" });
    await expect.poll(() => visible(frame, "Chrome on my laptop").count()).toBeGreaterThan(0);
    await shot(page, "bookmarks-1280-connect-code.png");
    // Copying works from the sandboxed frame, or the text is selected for the person to copy.
    await frame.getByRole("button", { name: "Copy" }).first().click();
    await expect.poll(() => frame.getByRole("status").filter({ hasText: /Copied|Press Cmd\+C/ }).count()).toBeGreaterThan(0);

    await frame.getByRole("button", { name: "Make a key" }).click();
    await expect.poll(async () => frame.getByRole("textbox", { name: "URL", exact: true }).inputValue()).toBe("https://home.example/api/local-apps/client/save_link");
    await expect.poll(async () => frame.getByRole("textbox", { name: "Authorization header" }).inputValue()).toBe("Bearer ri_live_fictional");

    // The bookmarklet is a real script link, holding the app's address and no key.
    const bookmarklet = await frame.locator(".bm-bookmarklet").getAttribute("href");
    expect(bookmarklet?.startsWith("javascript:")).toBe(true);
    expect(bookmarklet).toContain("https://home.example/apps/bookmarks/save");
    expect(bookmarklet).not.toContain("ri_live");

    await frame.getByRole("button", { name: /Download extension/ }).click();
    await expect.poll(async () => (await state(page)).downloads.length).toBe(1);
    const zip = (await state(page)).downloads[0][0].resource;
    expect(zip.mimeType).toBe("application/zip");
    expect(Buffer.from(zip.blob!, "base64").subarray(0, 2).toString()).toBe("PK");
    await frame.getByRole("button", { name: "Export bookmarks" }).click();
    await expect.poll(async () => (await state(page)).downloads.length).toBe(2);
    expect((await state(page)).downloads[1][0].resource.text).toContain("https://example.test/harbor");

    await frame.getByRole("button", { name: "Remove iPhone" }).click();
    await expect.poll(() => world.keys.map((key) => key.name)).toEqual(["Chrome on my laptop"]);
    await expect.poll(() => frame.getByRole("button", { name: "Remove iPhone" }).count()).toBe(0);
    expect(consoleErrors).toEqual([]);
    await page.close();
  });

  it("saves from the bookmarklet's window once, however often it opens", async () => {
    const world = await createWorld("save");
    const location = `/save?url=${encodeURIComponent("https://example.test/picked?utm_source=x")}&title=Picked&note=${encodeURIComponent("A chosen line")}`;
    const first = await open(world, "save", "owner", location, { width: 480, height: 640 });
    await expect.poll(() => visible(first.frame, "Saved.").count()).toBeGreaterThan(0);
    await expect.poll(() => first.frame.getByRole("textbox", { name: /Note/ }).inputValue()).toBe("A chosen line");
    await noOverflow(first.frame);
    await shot(first.page, "bookmarks-480-save.png");
    await first.frame.getByRole("textbox", { name: /Tags/ }).click();
    await first.frame.getByRole("textbox", { name: /Tags/ }).fill("kept");
    await first.frame.getByRole("button", { name: "Done" }).click();
    await expect.poll(() => visible(first.frame, "You can close this window.").count()).toBe(1);
    await first.page.close();
    const again = await open(world, "save", "owner", location, { width: 480, height: 640 });
    await expect.poll(() => again.frame.getByRole("textbox", { name: /Tags/ }).inputValue()).toBe("kept");
    await again.page.close();
    const list = (await world.engine.invoke(world.instance, "list_bookmarks", { limit: 10 }, PRINCIPALS.owner, 0)) as { items: { title: string; via: string; note: string; tags: string[] }[] };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ title: "Picked", via: "bookmarklet", note: "A chosen line", tags: ["kept"] });
  });
});
