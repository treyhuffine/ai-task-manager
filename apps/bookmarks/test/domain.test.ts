import { describe, expect, it } from "vitest";
import { bookmarkletFor, connectionCode } from "../src/domain/client.js";
import { readHtml, readPlainText, MAX_PAGE_CHARS } from "../src/domain/page.js";
import { mergeDuplicates, parseBrowserHtml, parseCsv, parseCsvRows, parseImport, parseLinkList, toBrowserHtml, MAX_IMPORT } from "../src/domain/parse.js";
import { cleanTags, parseLink, parseSavedAt } from "../src/domain/url.js";
import { readSelectedFile, splitParts } from "../src/view/util.js";

describe("links", () => {
  const key = (url: string) => parseLink(url)?.key;
  it("treats the same page as the same link", () => {
    const base = key("https://example.test/guide");
    for (const same of ["https://EXAMPLE.test/guide", "https://example.test/guide/", "https://example.test:443/guide", "https://example.test/guide#section", "https://example.test/guide?utm_source=mail&fbclid=abc", "https://example.test/guide?gclid=1"]) expect(key(same), same).toBe(base);
  });
  it("keeps what really changes the page", () => {
    const base = key("https://example.test/guide");
    for (const other of ["http://example.test/guide", "https://www.example.test/guide", "https://example.test/guide?page=2", "https://example.test/Guide", "https://example.test/guide#/route", "https://example.test/guide#!/route"]) expect(key(other), other).not.toBe(base);
    expect(key("https://example.test/a?id=1&utm_medium=x")).toBe("https://example.test/a?id=1");
  });
  it("keeps the link as saved for opening", () => {
    expect(parseLink("https://www.example.test/guide/?utm_source=x")).toMatchObject({ url: "https://www.example.test/guide/?utm_source=x", site: "example.test" });
  });
  it("refuses a link that grows past what a record can hold once encoded", () => {
    expect(parseLink(`https://example.test/${"\u6f22".repeat(900)}`)).toBeNull();
    expect(parseLink(`https://${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(60)}.example/`)).toBeNull();
    expect(parseLink(`https://example.test/${"\u6f22".repeat(100)}`)).not.toBeNull();
  });
  it("refuses anything that is not a plain web link", () => {
    for (const bad of ["javascript:alert(1)", "chrome://settings", "file:///etc/hosts", "place:sort=8", "about:blank", "not a link", "", "https://user:secret@example.test/", `https://example.test/${"a".repeat(5000)}`]) expect(parseLink(bad), bad).toBeNull();
  });
  it("cleans tags", () => {
    expect(cleanTags([" Rust ", "#rust", "Web  Dev", "", "x".repeat(60)])).toEqual(["rust", "web dev", "x".repeat(40)]);
    expect(cleanTags(Array.from({ length: 40 }, (_, index) => `t${index}`))).toHaveLength(20);
  });
  it("reads dates in every form exports use", () => {
    expect(parseSavedAt(1670000000)).toBe("2022-12-02T16:53:20.000Z");
    expect(parseSavedAt("1670000000000")).toBe("2022-12-02T16:53:20.000Z");
    expect(parseSavedAt("1670000000000000")).toBe("2022-12-02T16:53:20.000Z");
    expect(parseSavedAt("2022-12-02T16:53:20Z")).toBe("2022-12-02T16:53:20.000Z");
    for (const bad of ["soon", "", null, undefined, 0, "4102444800"]) expect(parseSavedAt(bad), String(bad)).toBeNull();
  });
});

const NETSCAPE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1670000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://example.test/top" ADD_DATE="1670000000" ICON="data:image/png;base64,AAAA">Top &amp; level</A>
        <DT><H3>Sailing</H3>
        <DL><p>
            <DT><A HREF="https://harborlog.example/tide" ADD_DATE="1680000000" TAGS="tides,planning">Tide tables</A>
            <DD>Check before the trip
            <DT><H3>Knots &amp; lines</H3>
            <DL><p>
                <DT><A HREF="https://harborlog.example/knots">Knots</A>
            </DL><p>
        </DL><p>
        <DT><A HREF="https://example.test/after">After the folder</A>
        <DT><A HREF="javascript:void(0)">A script</A>
        <DT><A HREF="chrome://settings">Settings</A>
    </DL><p>
    <DT><H3>Other bookmarks</H3>
    <DL><p>
        <DT><A HREF="https://example.test/other">Other</A>
    </DL><p>
</DL><p>`;

describe("bookmark files", () => {
  it("reads a browser export with folders as tags, dropping the ones browsers make", () => {
    const parsed = parseBrowserHtml(NETSCAPE);
    expect(parsed.format).toBe("browser_html");
    expect(parsed.skipped).toBe(2);
    expect(parsed.links.map((link) => [link.title, link.tags])).toEqual([
      ["Top & level", []],
      ["Tide tables", ["sailing", "tides", "planning"]],
      ["Knots", ["sailing", "knots & lines"]],
      ["After the folder", []],
      ["Other", []],
    ]);
    expect(parsed.links[1]).toMatchObject({ note: "Check before the trip", savedAt: "2023-03-28T10:40:00.000Z" });
    expect(parsed.links[0].note).toBeNull();
  });
  it("keeps a title that talks about markup", () => {
    const titled = (title: string) => parseBrowserHtml(`<dt><a href="https://example.test/">${title}</a>`).links[0].title;
    expect(titled("&lt;a&gt;: The Anchor element - HTML | MDN")).toBe("<a>: The Anchor element - HTML | MDN");
    expect(titled("Array&lt;T&gt; in TypeScript")).toBe("Array<T> in TypeScript");
    expect(titled("if a &lt; b and c &gt; d")).toBe("if a < b and c > d");
    expect(titled("<b>Bold</b> title")).toBe("Bold title");
  });
  it("survives a file with no doctype and unbalanced lists", () => {
    const parsed = parseImport('<dl></dl></dl><dt><a href="https://example.test/a">A</a><dt><a href=https://example.test/b>B</a><dt><a>no link</a>');
    expect(parsed.links.map((link) => link.url)).toEqual(["https://example.test/a", "https://example.test/b"]);
  });
  it("reads a Raindrop CSV export", () => {
    const csv = 'id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite\n1,"Tide, tables","A ""quoted"" note","An excerpt",https://harborlog.example/tide,Sailing/Planning,"tides, boats",2023-03-28T10:40:00.000Z,,,false\n2,No link,,,not-a-link,Unsorted,,,,,\n3,Second,,,https://example.test/2,Unsorted,,,,,\n';
    const parsed = parseImport(csv);
    expect(parsed.format).toBe("csv");
    expect(parsed.skipped).toBe(1);
    expect(parsed.links[0]).toMatchObject({ title: "Tide, tables", note: 'A "quoted" note', excerpt: "An excerpt", tags: ["sailing", "planning", "tides", "boats"], savedAt: "2023-03-28T10:40:00.000Z" });
    expect(parsed.links[1].tags).toEqual([]);
  });
  it("parses CSV quoting, newlines inside quotes and a byte order mark", () => {
    expect(parseCsvRows('﻿a,b\r\n"1\n2","x""y"\n')).toEqual([["a", "b"], ["1\n2", 'x"y']]);
    expect(parseCsv("title,other\nA,B\n")).toBeNull();
  });
  it("finds links in free text", () => {
    const parsed = parseImport("Read https://example.test/a, then (https://example.test/b).\nAlso http://example.test/c?x=1!\nnot a link\njavascript:alert(1)");
    expect(parsed.format).toBe("link_list");
    expect(parsed.links.map((link) => link.url)).toEqual(["https://example.test/a", "https://example.test/b", "http://example.test/c?x=1"]);
  });
  it("stops at the limit and says so", () => {
    const text = Array.from({ length: MAX_IMPORT + 5 }, (_, index) => `https://example.test/${index}`).join("\n");
    const parsed = parseLinkList(text);
    expect(parsed.links).toHaveLength(MAX_IMPORT);
    expect(parsed.truncated).toBe(true);
  });
  it("merges the same page within one file", () => {
    const merged = mergeDuplicates(parseBrowserHtml('<dt><h3>A</h3><dl><dt><a href="https://example.test/x" add_date="1680000000">One</a></dl><dt><h3>B</h3><dl><dt><a href="https://example.test/x/?utm_source=y" add_date="1670000000">Two</a></dl>').links);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ title: "One", tags: ["a", "b"], savedAt: "2022-12-02T16:53:20.000Z" });
  });
  it("writes a file that reads back the same", () => {
    const html = toBrowserHtml([{ url: "https://example.test/a?x=1&y=2", title: 'A "title" <b>', note: "A note\nwith lines", tags: ["one", "two"], savedAt: "2023-03-28T10:40:00.000Z" }]);
    expect(parseImport(html).links[0]).toMatchObject({ url: "https://example.test/a?x=1&y=2", title: 'A "title" <b>', note: "A note with lines", tags: ["one", "two"], savedAt: "2023-03-28T10:40:00.000Z" });
  });
});

describe("pages", () => {
  it("reads the title and description, and prefers the article over page furniture", () => {
    const body = "Tide tables list the height of the water at each hour. ".repeat(8);
    const page = readHtml(`<html><head><title>Tide &amp; tables</title><meta content="A short guide" name="description"><style>.x{}</style></head><body><nav>Home About</nav><article><p>${body}</p></article><footer>Copyright</footer><script>alert(1)</script></body></html>`);
    expect(page).toMatchObject({ title: "Tide & tables", excerpt: "A short guide" });
    expect(page.text).toContain("height of the water");
    for (const noise of ["Home About", "Copyright", "alert"]) expect(page.text).not.toContain(noise);
  });
  it("falls back to the whole page when the article is thin, and to the page for the excerpt", () => {
    const page = readHtml("<title>T</title><article>Short</article><div>The rest of the page has the words.</div>");
    expect(page.text).toContain("The rest of the page");
    expect(page.excerpt).toContain("rest of the page");
  });
  it("leaves list markers out of the excerpt", () => {
    expect(readHtml("<ul><li>One thing</li><li>Another</li></ul>").excerpt).toBe("One thing Another");
  });
  it("bounds what it keeps", () => {
    expect(readPlainText("x ".repeat(MAX_PAGE_CHARS)).text.length).toBeLessThanOrEqual(MAX_PAGE_CHARS);
    expect(readHtml(`<body>${"word ".repeat(100_000)}</body>`).text.length).toBeLessThanOrEqual(MAX_PAGE_CHARS);
  });
  it("finds nothing in a page drawn entirely by scripts", () => {
    expect(readHtml('<html><head><title>App</title></head><body><div id="root"></div><script src="/a.js"></script></body></html>').text).toBe("");
  });
});

describe("reading a chosen file", () => {
  const encoded = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  const CSV = "title,url\nCaf\u00e9,https://example.test/a\n";
  it("reads UTF-8, UTF-16 and Windows-1252", () => {
    expect(readSelectedFile(encoded(Buffer.from(CSV, "utf8")))).toBe(CSV);
    expect(readSelectedFile(encoded(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(CSV, "utf16le")])))).toBe(CSV);
    expect(readSelectedFile(encoded(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(CSV, "utf16le").swap16()])))).toBe(CSV);
    expect(readSelectedFile(encoded(Buffer.from(CSV, "latin1")))).toBe(CSV);
    expect(parseImport(readSelectedFile(encoded(Buffer.from(CSV, "latin1")))).links[0].title).toBe("Caf\u00e9");
  });
  it("drops inline favicons and splits into parts under the action limit, in any script", () => {
    expect(readSelectedFile(encoded(Buffer.from('<A HREF="https://example.test/" ICON="data:image/png;base64,AAAA" ICON_URI="x">A</A>')))).toBe('<A HREF="https://example.test/">A</A>');
    const parts = splitParts("\u6f22".repeat(700_000));
    expect(parts).toHaveLength(3);
    for (const part of parts) expect(Buffer.byteLength(JSON.stringify({ text: part }))).toBeLessThan(1024 * 1024);
  });
});

describe("client setup", () => {
  it("carries the address and key in one code the extension can read", () => {
    const code = connectionCode({ homeUrl: "https://home.example", appUrl: "https://home.example/apps/bookmarks", key: "k" });
    expect(JSON.parse(Buffer.from(code.slice("ri-bookmarks:".length), "base64url").toString())).toEqual({ v: 1, home: "https://home.example", app: "https://home.example/apps/bookmarks", key: "k" });
  });
  it("makes a bookmarklet that holds no key and escapes its address", () => {
    const code = bookmarkletFor("https://home.example/apps/bookmarks");
    expect(code.startsWith("javascript:")).toBe(true);
    expect(code).toContain('"https://home.example/apps/bookmarks/save"');
    expect(code.length).toBeLessThan(1200);
    expect(() => new Function(code.slice("javascript:".length))).not.toThrow();
  });
});
