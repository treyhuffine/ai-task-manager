/**
 * The real extension in real Chromium, against a stand-in Home that speaks the
 * same route. Headless automation can't answer the permission prompt, so this
 * copy of the extension is given the test server's address up front. That
 * prompt, and an actual Cmd+D keystroke, are the parts it can't cover: creating
 * a bookmark through the browser's API fires the same event.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Page, type Worker } from "playwright-core";
import { connectionCode } from "../src/domain/client.js";
import { EXTENSION_PACKAGE } from "../src/extension-package.generated.js";

/** The browser's extension API, inside the functions this test runs in the browser. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const source = path.resolve(import.meta.dirname, "../extension");
const KEY = "ri_live_fictional";
interface Saved { via: string; items: { url: string; title?: string; tags?: string[]; note?: string | null; pageText?: string | null; savedAt?: number | null }[] }

let server: http.Server;
let home: string;
let received: Saved[] = [];
let answer: (action: string) => number = () => 200;
const auth: string[] = [];

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url!, "http://local");
    if (request.method === "GET") {
      response.setHeader("content-type", "text/html");
      return response.end(`<html><head><title>A logged-in page</title><meta name="description" content="Short description"></head><body><nav>Menu</nav><article><p>${"Only people signed in can read this sentence about marmalade. ".repeat(10)}</p></article></body></html>`);
    }
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      const action = url.pathname.split("/").at(-1)!;
      const status = answer(action);
      response.setHeader("content-type", "application/json");
      if (request.headers.authorization !== `Bearer ${KEY}` || status === 401) { response.statusCode = 401; return response.end('{"error":"unauthorized"}'); }
      auth.push(request.headers.authorization);
      if (status !== 200) { response.statusCode = status; return response.end('{"error":"busy"}'); }
      if (action === "describe_connection") return response.end('{"app":"Bookmarks","ok":true}');
      const body = JSON.parse(text) as Saved;
      received.push(body);
      response.end(JSON.stringify({ saved: body.items.length, invalid: 0 }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  home = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

let context: BrowserContext;
let worker: Worker;
let extensionId: string;
const dirs: string[] = [];

beforeEach(async () => {
  received = [];
  answer = () => 200;
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "ri-bookmarks-ext-"));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ri-bookmarks-profile-"));
  dirs.push(copy, profile);
  fs.cpSync(source, copy, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(copy, "manifest.json"), "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  fs.writeFileSync(path.join(copy, "manifest.json"), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`] });
  context.setDefaultTimeout(15_000);
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  extensionId = new URL(worker.url()).host;
}, 60_000);
afterEach(async () => {
  await context?.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const code = () => connectionCode({ homeUrl: home, appUrl: `${home}/apps/bookmarks`, key: KEY });
async function options(): Promise<Page> {
  // Installing opens the options page by itself. Reuse it when it is there.
  const existing = context.pages().find((page) => page.url().includes("options.html"));
  const page = existing ?? (await context.newPage());
  if (!existing) await page.goto(`chrome-extension://${extensionId}/options.html`);
  return page;
}
async function connect(): Promise<Page> {
  const page = await options();
  await page.getByLabel("Connection code").fill(code());
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("heading", { name: "Connected" }).waitFor();
  return page;
}
const addBookmark = (input: { title: string; url: string; folder?: string }) => worker.evaluate(async ({ title, url, folder }) => {
  const parentId = folder ? (await chrome.bookmarks.create({ parentId: "1", title: folder })).id : "1";
  await chrome.bookmarks.create({ parentId, title, url });
}, input);
const stored = <T,>(key: string) => worker.evaluate(async (name) => (await chrome.storage.local.get(name))[name], key) as Promise<T>;

describe("the package", () => {
  it("loads from the zip the app offers, with its real manifest", async () => {
    await context.close();
    const unpacked = fs.mkdtempSync(path.join(os.tmpdir(), "ri-bookmarks-zip-"));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ri-bookmarks-profile-"));
    dirs.push(unpacked, profile);
    const zip = path.join(unpacked, "extension.zip");
    fs.writeFileSync(zip, Buffer.from(EXTENSION_PACKAGE.base64, "base64"));
    execFileSync("unzip", ["-q", zip, "-d", path.join(unpacked, "extension")]);
    const folder = path.join(unpacked, "extension");
    context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${folder}`, `--load-extension=${folder}`] });
    context.setDefaultTimeout(15_000);
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    extensionId = new URL(worker.url()).host;
    const page = await options();
    await page.getByLabel("Connection code").waitFor();
    const held = await worker.evaluate(() => chrome.permissions.getAll());
    expect(held.origins).toEqual([]);
    expect([...(held.permissions ?? [])].sort()).toEqual(["activeTab", "alarms", "bookmarks", "scripting", "storage"]);
  });
});

describe("connecting", () => {
  it("opens its options when installed, and refuses a bad code", async () => {
    await expect.poll(() => context.pages().some((page) => page.url().endsWith("options.html"))).toBe(true);
    const page = await options();
    await page.getByLabel("Connection code").fill("hello");
    await page.getByRole("button", { name: "Connect" }).click();
    await expect.poll(() => page.getByRole("alert").first().textContent()).toContain("not a connection code");
    expect(await stored("connection")).toBeUndefined();
  });
  it("refuses a code the Home doesn't accept, and keeps nothing", async () => {
    const page = await options();
    await page.getByLabel("Connection code").fill(connectionCode({ homeUrl: home, appUrl: home, key: "wrong" }));
    await page.getByRole("button", { name: "Connect" }).click();
    await expect.poll(() => page.getByRole("alert").first().textContent()).toContain("did not accept");
    expect(await stored("connection")).toBeUndefined();
  });
  it("connects with one paste and disconnects", async () => {
    const page = await connect();
    await expect.poll(() => page.locator("#home").textContent()).toBe(home);
    await page.screenshot({ path: path.resolve(import.meta.dirname, "../artifacts/extension-options.png") });
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.getByLabel("Connection code").waitFor();
    expect(await stored("connection")).toBeUndefined();
  });
});

describe("normal bookmarks", () => {
  it("copies a bookmark to Ri, with its folder as a tag", async () => {
    await connect();
    await addBookmark({ title: "Tide tables", url: "https://harbor.example/tide", folder: "Sailing" });
    await expect.poll(() => received.flatMap((batch) => batch.items).length).toBe(1);
    expect(received[0].via).toBe("bookmark");
    expect(received[0].items[0]).toMatchObject({ url: "https://harbor.example/tide", title: "Tide tables", tags: ["Sailing"] });
    expect(received[0].items[0].pageText).toBeUndefined();
  });
  it("ignores folders, browser pages and everything while switched off", async () => {
    const page = await connect();
    await addBookmark({ title: "Settings", url: "chrome://settings/" });
    await page.getByLabel("Copy bookmarks I make to Ri").uncheck();
    await addBookmark({ title: "Off", url: "https://example.test/off" });
    await page.getByLabel("Copy bookmarks I make to Ri").check();
    await addBookmark({ title: "On", url: "https://example.test/on" });
    await expect.poll(() => received.flatMap((batch) => batch.items).map((item) => item.title)).toEqual(["On"]);
  });
  it("keeps links while the Home is away and sends them when it answers, losing nothing", async () => {
    await connect();
    answer = () => 503;
    await addBookmark({ title: "One", url: "https://example.test/1" });
    await addBookmark({ title: "Two", url: "https://example.test/2" });
    await expect.poll(async () => (await stored<unknown[]>("queue") ?? []).length).toBe(2);
    expect(received).toEqual([]);
    const page = await options();
    await expect.poll(() => page.locator("#queue").textContent()).toContain("2 links are waiting");
    answer = () => 200;
    await worker.evaluate(() => chrome.alarms.create("flush", { when: Date.now() + 10, periodInMinutes: 5 }));
    await expect.poll(() => received.flatMap((batch) => batch.items).map((item) => item.title), { timeout: 90_000 }).toEqual(["One", "Two"]);
    await expect.poll(async () => (await stored<unknown[]>("queue") ?? []).length).toBe(0);
  }, 120_000);
  it("says when the key stops working and keeps what it couldn't send", async () => {
    const page = await connect();
    answer = () => 401;
    await addBookmark({ title: "Late", url: "https://example.test/late" });
    await expect.poll(() => page.locator("#broken").textContent()).toContain("Disconnect, then connect again");
    expect((await stored<unknown[]>("queue")).length).toBe(1);
    await expect.poll(() => worker.evaluate(() => chrome.action.getBadgeText({}))).toBe("!");
  });
  it("doesn't let a link the Home refuses block the ones behind it", async () => {
    await connect();
    let refused = 0;
    answer = () => (refused++ === 0 ? 400 : 200);
    await addBookmark({ title: "Refused", url: "https://example.test/bad" });
    await addBookmark({ title: "Fine", url: "https://example.test/fine" });
    await worker.evaluate(() => chrome.alarms.create("flush", { when: Date.now() + 10, periodInMinutes: 5 }));
    await expect.poll(() => received.flatMap((batch) => batch.items).map((item) => item.title), { timeout: 90_000 }).toContain("Fine");
    await expect.poll(async () => (await stored<unknown[]>("queue") ?? []).length).toBe(0);
  }, 120_000);
});

describe("the toolbar button", () => {
  /**
   * Headless Chromium has no toolbar to click. The popup opens as a page, told
   * which tab is active. Reading that tab, and calling the Home, are the real thing.
   */
  async function openPopup(url: string) {
    const tab = await context.newPage();
    await tab.goto(url);
    const target = await worker.evaluate(async (address) => (await chrome.tabs.query({})).find((item: { url?: string }) => item.url === address), url);
    const popup = await context.newPage();
    await popup.addInitScript((active) => { chrome.tabs.query = (async () => [active]) as unknown as typeof chrome.tabs.query; }, target);
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    return { tab, popup };
  }
  it("saves the tab with the text you can see, and adds tags and a note after", async () => {
    await connect();
    const { popup, tab } = await openPopup(`${home}/behind-login`);
    await popup.getByText("Saved with the page text").waitFor();
    expect(received[0].via).toBe("extension");
    expect(received[0].items[0]).toMatchObject({ url: `${home}/behind-login`, title: "A logged-in page", excerpt: "Short description" });
    expect(received[0].items[0].pageText).toContain("sentence about marmalade");
    expect(received[0].items[0].pageText).not.toContain("Menu");
    await popup.setViewportSize({ width: 320, height: 340 });
    await popup.screenshot({ path: path.resolve(import.meta.dirname, "../artifacts/extension-popup.png") });
    await popup.getByLabel("Tags").fill("jam, reading");
    await popup.getByLabel("Note").fill("For later");
    await popup.getByRole("button", { name: "Add" }).click();
    await expect.poll(() => received.length).toBe(2);
    expect(received[1].items[0]).toMatchObject({ url: `${home}/behind-login`, tags: ["jam", "reading"], note: "For later" });
    await tab.close();
  });
  it("asks to connect first, and refuses a page that isn't on the web", async () => {
    const first = await openPopup(`${home}/page`);
    await first.popup.getByRole("button", { name: "Connect to your Ri" }).waitFor();
    await first.popup.close();
    await connect();
    const popup = await context.newPage();
    await popup.addInitScript(() => { chrome.tabs.query = (async () => [{ id: 1, url: "chrome://settings/", title: "Settings" }]) as unknown as typeof chrome.tabs.query; });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByText("Only web pages can be saved.").waitFor();
    expect(received).toEqual([]);
  });
  it("still saves the link when the page refuses to be read", async () => {
    await connect();
    const popup = await context.newPage();
    await popup.addInitScript(() => { chrome.tabs.query = (async () => [{ id: 999999, url: "https://chromewebstore.google.com/detail/x", title: "A store page" }]) as unknown as typeof chrome.tabs.query; });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByText("Saved", { exact: true }).waitFor();
    expect(received[0].items[0]).toMatchObject({ url: "https://chromewebstore.google.com/detail/x", title: "A store page", pageText: null });
  });
  it("keeps the page for later when the Home can't be reached", async () => {
    await connect();
    answer = () => 503;
    const { popup } = await openPopup(`${home}/offline`);
    await popup.getByText(/out of reach/).waitFor();
    await expect.poll(async () => (await stored<{ url: string; pageText: string }[]>("queue") ?? []).map((item) => item.url)).toEqual([`${home}/offline`]);
    expect((await stored<{ pageText: string }[]>("queue"))[0].pageText).toContain("marmalade");
    answer = () => 200;
    await worker.evaluate(() => chrome.alarms.create("flush", { when: Date.now() + 10, periodInMinutes: 5 }));
    await expect.poll(() => received.flatMap((batch) => batch.items).map((item) => item.url), { timeout: 90_000 }).toEqual([`${home}/offline`]);
    expect(received[0].via).toBe("extension");
  }, 120_000);
});

describe("importing", () => {
  it("sends every bookmark in batches, with folders as tags, and can repeat", async () => {
    const page = await connect();
    await page.getByLabel("Copy bookmarks I make to Ri").uncheck();
    await worker.evaluate(async () => {
      const folder = await chrome.bookmarks.create({ parentId: "1", title: "Reading" });
      for (let index = 0; index < 230; index++) await chrome.bookmarks.create({ parentId: folder.id, title: `Link ${index}`, url: `https://example.test/${index}` });
      await chrome.bookmarks.create({ parentId: "1", title: "A script", url: "javascript:void(0)" });
    });
    expect(received).toEqual([]);
    await page.reload();
    await page.getByRole("button", { name: "Import 230 bookmarks" }).click();
    await expect.poll(() => page.locator("#import-status").textContent()).toBe("Sent 230 bookmarks to Ri.");
    expect(received.map((batch) => batch.items.length)).toEqual([100, 100, 30]);
    expect(received[0].items[0]).toMatchObject({ title: "Link 0", tags: ["Reading"] });
    expect(received.every((batch) => batch.via === "bookmark")).toBe(true);
  }, 60_000);
  it("stops cleanly if the Home goes away, and says how far it got", async () => {
    const page = await connect();
    await page.getByLabel("Copy bookmarks I make to Ri").uncheck();
    await worker.evaluate(async () => { for (let index = 0; index < 150; index++) await chrome.bookmarks.create({ parentId: "1", title: `L${index}`, url: `https://example.test/${index}` }); });
    let calls = 0;
    answer = () => (++calls > 1 ? 503 : 200);
    await page.reload();
    await page.getByRole("button", { name: "Import 150 bookmarks" }).click();
    await expect.poll(() => page.locator("#import-status").textContent()).toContain("Stopped after 100");
  }, 60_000);
});
