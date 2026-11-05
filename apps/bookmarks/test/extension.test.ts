/** The extension's logic, and that the copy the app offers matches the folder. Runs the real module with fake browser parts. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { EXTENSION_PACKAGE } from "../src/extension-package.generated.js";
import { connectionCode } from "../src/domain/client.js";
import { buildZip, generatedSource, listFiles } from "../scripts/package-extension.js";
// @ts-expect-error plain JavaScript, on purpose: the folder loads into a browser as it is.
import * as lib from "../extension/lib.js";

const root = path.resolve(import.meta.dirname, "..");
const extension = path.join(root, "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(extension, "manifest.json"), "utf8"));

describe("manifest", () => {
  it("asks for no site access up front and no more than it uses", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect([...manifest.permissions].sort()).toEqual(["activeTab", "alarms", "bookmarks", "scripting", "storage"]);
    expect(manifest.permissions).not.toContain("tabs");
    expect(manifest.version).toBe(JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8")).version);
  });
  it("names only files that exist", () => {
    for (const file of [...Object.values(manifest.icons), manifest.action.default_popup, manifest.background.service_worker, manifest.options_ui.page]) expect(fs.existsSync(path.join(extension, String(file))), String(file)).toBe(true);
  });
  it("uses copy without long dashes or semicolons", () => {
    for (const file of ["popup.html", "options.html"]) {
      const text = fs.readFileSync(path.join(extension, file), "utf8").replace(/<style>[\s\S]*?<\/style>/g, "").replace(/style="[^"]*"/g, "");
      expect(text, file).not.toMatch(/[—–]/);
      expect(text.replace(/<[^>]+>/g, ""), file).not.toContain(";");
    }
  });
});

describe("package", () => {
  it("embeds exactly what is in the folder", () => {
    const zip = buildZip(extension);
    expect(EXTENSION_PACKAGE.base64, "Run pnpm --filter ri-bookmarks extension:package").toBe(zip.toString("base64"));
    expect(fs.readFileSync(path.join(root, "src/extension-package.generated.ts"), "utf8")).toBe(generatedSource(manifest.version, zip));
    expect(EXTENSION_PACKAGE.version).toBe(manifest.version);
  });
  it("is a valid zip of every file", () => {
    const zip = buildZip(extension);
    const names: string[] = [];
    let offset = 0;
    while (zip.readUInt32LE(offset) === 0x04034b50) {
      const packed = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26);
      const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
      names.push(name);
      const data = inflateRawSync(zip.subarray(offset + 30 + nameLength, offset + 30 + nameLength + packed));
      expect(data.equals(fs.readFileSync(path.join(extension, name))), name).toBe(true);
      offset += 30 + nameLength + packed;
    }
    expect(names).toEqual(listFiles(extension));
    expect(zip.length).toBeLessThan(500 * 1024);
  });
});

describe("connection code", () => {
  it("reads what the app makes", () => {
    const code = connectionCode({ homeUrl: "https://home.example/", appUrl: "https://home.example/apps/bookmarks", key: "ri_live_k" });
    expect(lib.parseConnectionCode(`  ${code}\n`)).toEqual({ home: "https://home.example", app: "https://home.example/apps/bookmarks", key: "ri_live_k" });
  });
  it("refuses anything else", () => {
    const encode = (value: unknown) => `ri-bookmarks:${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
    for (const bad of ["", "hello", "ri-bookmarks:", "ri-bookmarks:!!!", encode({ v: 2, home: "https://a.example", key: "k" }), encode({ v: 1, home: "file:///etc", key: "k" }), encode({ v: 1, home: "https://a.example" }), encode({ v: 1, key: "k" })]) expect(lib.parseConnectionCode(bad), bad).toBeNull();
  });
  it("asks only for the Home's own address", () => {
    expect(lib.originPattern("https://home.example/some/path")).toBe("https://home.example/*");
    expect(lib.actionUrl("https://home.example/", "save_bookmarks")).toBe("https://home.example/api/local-apps/client/save_bookmarks");
  });
});

describe("bookmarks tree", () => {
  const tree = [{ id: "0", title: "", children: [
    { id: "1", title: "Bookmarks bar", children: [
      { id: "2", title: "Top", url: "https://example.test/top", dateAdded: 1670000000000 },
      { id: "3", title: "Sailing", children: [{ id: "4", title: "Tide", url: "https://harbor.example/tide" }, { id: "5", title: "Tools", children: [{ id: "6", title: "", url: "http://tools.example/" }] }] },
      { id: "7", title: "A script", url: "javascript:alert(1)" },
      { id: "8", title: "Settings", url: "chrome://settings" },
    ] },
    { id: "9", title: "Other bookmarks", children: [{ id: "10", title: "Other", url: "https://example.test/other" }] },
  ] }];
  it("flattens to web links with folders as tags", () => {
    expect(lib.flattenTree(tree)).toEqual([
      { url: "https://example.test/top", title: "Top", savedAt: 1670000000000, tags: [] },
      { url: "https://harbor.example/tide", title: "Tide", savedAt: null, tags: ["Sailing"] },
      { url: "http://tools.example/", title: null, savedAt: null, tags: ["Sailing", "Tools"] },
      { url: "https://example.test/other", title: "Other", savedAt: null, tags: [] },
    ]);
  });
  it("splits a large library into batches the Home accepts", () => {
    const parts = lib.batches(Array.from({ length: 250 }, (_, index) => ({ url: `https://example.test/${index}` })));
    expect(parts.map((part: unknown[]) => part.length)).toEqual([100, 100, 50]);
  });
  it("keeps each request under the Home's size limit, in any script", () => {
    const big = (text: string) => ({ url: "https://example.test/", pageText: text.repeat(lib.QUEUED_PAGE_CHARS) });
    for (const character of ["x", "\u6f22"]) {
      const parts = lib.batches(Array.from({ length: 30 }, () => big(character)));
      expect(parts.flat()).toHaveLength(30);
      for (const part of parts) expect(new TextEncoder().encode(JSON.stringify({ via: "extension", items: part })).length).toBeLessThan(1024 * 1024);
    }
    expect(lib.batches([{ url: "https://example.test/", pageText: "\u6f22".repeat(lib.MAX_PAGE_CHARS) }])).toHaveLength(1);
  });
  it("fits an item to what the Home accepts, and leaves out a link it can't keep", () => {
    expect(lib.fitItem({ url: `https://example.test/${"a".repeat(5000)}` })).toBeNull();
    expect(lib.fitItem({ url: "javascript:alert(1)" })).toBeNull();
    const fitted = lib.fitItem({ url: "https://example.test/", title: "t".repeat(3000), excerpt: "e".repeat(3000), note: "n".repeat(9000), tags: Array.from({ length: 60 }, () => "f".repeat(300)), pageText: "p".repeat(300_000) });
    expect([fitted.title.length, fitted.excerpt.length, fitted.note.length, fitted.tags.length, fitted.tags[0].length, fitted.pageText.length]).toEqual([2000, 2000, 8000, 50, 200, lib.MAX_PAGE_CHARS]);
    expect(lib.flattenTree([{ url: `https://example.test/${"a".repeat(5000)}`, title: "Too long" }, { url: "https://example.test/ok", title: "Fine" }]).map((link: { title: string }) => link.title)).toEqual(["Fine"]);
  });
});

describe("calling the Home", () => {
  const connection = { home: "https://home.example", app: "https://home.example/apps/bookmarks", key: "ri_live_k" };
  const replying = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
  it("sends the key and body to the action's address", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const result = await lib.callHome(async (url: string, init: RequestInit) => { seen = { url, init }; return new Response('{"saved":1,"invalid":0}'); }, connection, lib.SAVE_ACTION, { via: "extension", items: [] });
    expect(result).toEqual({ outcome: "ok", body: { saved: 1, invalid: 0 } });
    expect(seen!.url).toBe("https://home.example/api/local-apps/client/save_bookmarks");
    expect(seen!.init.headers).toMatchObject({ authorization: "Bearer ri_live_k" });
  });
  it("tells a dead key from a bad link from an unreachable Home", async () => {
    expect((await lib.callHome(replying(401, { error: "unauthorized" }), connection, "x", {})).outcome).toBe("disconnected");
    expect((await lib.callHome(replying(403, { error: "no" }), connection, "x", {})).outcome).toBe("disconnected");
    expect((await lib.callHome(replying(400, { error: "bad" }), connection, "x", {})).outcome).toBe("rejected");
    expect((await lib.callHome(replying(413, { error: "big" }), connection, "x", {})).outcome).toBe("rejected");
    expect((await lib.callHome(replying(503, { error: "busy" }), connection, "x", {})).outcome).toBe("retry");
    expect((await lib.callHome(async () => { throw new Error("offline"); }, connection, "x", {})).outcome).toBe("retry");
    expect((await lib.callHome(async () => new Response("<html>", { status: 502 }), connection, "x", {})).outcome).toBe("retry");
  });
  it("drops only the item the Home refuses, and stops without losing anything when it goes away", async () => {
    const items = ["a", "bad", "c"].map((name) => ({ url: `https://example.test/${name}` }));
    const sent: number[] = [];
    const refusing = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      sent.push(body.items.length);
      return new Response(JSON.stringify({ error: "bad" }), { status: body.items.some((item: { url: string }) => item.url.endsWith("bad")) ? 400 : 200 });
    };
    expect(await lib.sendItems(refusing, connection, "bookmark", items)).toEqual({ outcome: "ok", done: 3, dropped: 1, message: "bad" });
    expect(sent).toEqual([3, 1, 1, 1]);
    let calls = 0;
    const leaving = async () => new Response('{"error":"nope"}', { status: ++calls === 1 ? 413 : calls === 2 ? 200 : 503 });
    expect(await lib.sendItems(leaving, connection, "bookmark", items)).toMatchObject({ outcome: "retry", done: 1, dropped: 0 });
  });
  it("keeps queued items small", () => {
    expect(lib.forQueue({ url: "u", pageText: "x".repeat(100_000) }).pageText).toHaveLength(lib.QUEUED_PAGE_CHARS);
    expect(lib.forQueue({ url: "u" })).toEqual({ url: "u" });
    expect(lib.clipText("x".repeat(300_000))).toHaveLength(lib.MAX_PAGE_CHARS);
    expect(lib.clipText("")).toBeNull();
    expect(lib.parseTags(" a, b\nc,,")).toEqual(["a", "b", "c"]);
  });
});
