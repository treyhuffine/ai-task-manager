/**
 * Renders the UI kit gallery in a real Chromium browser under the view CSP and
 * checks layout, keyboard behavior and the host bridge. Screenshots go to
 * artifacts/ui-gallery for visual review.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { prepareHtml } from "@ri/app-kit/build";
import { viewPolicy } from "@ri/app-kit/view-host";

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(packageRoot, "artifacts", "ui-gallery");
const WIDTHS = [1280, 760, 390, 360] as const;
const THEMES = ["light", "dark"] as const;
const PAGES = ["travel", "jobs", "people", "states", "forms"] as const;

function browserPath(): string {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ];
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  if (fs.existsSync(cache))
    for (const folder of fs.readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse())
      for (const platform of ["chrome-mac-arm64", "chrome-mac", "chrome-mac-x64"])
        candidates.push(path.join(cache, folder, platform, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("The UI gallery check needs an installed Chromium browser");
  return found;
}

async function compile(source: string, development = true): Promise<string> {
  const result = await build({
    stdin: { contents: source, resolveDir: packageRoot, loader: "js" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2023",
    logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify(development ? "development" : "production") },
  });
  return result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
}
/** A page with the same CSP as an app view: inline scripts and styles, no network. */
const viewPage = (script: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${viewPolicy()}"><title>UI kit gallery</title></head><body><div id="root"></div><script>${script}</script></body></html>`;

let browser: Browser;
let server: http.Server;
let origin = "";
let galleryHtml = "";
let hostHtml = "";

beforeAll(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const ui = JSON.stringify(require.resolve("@ri/app-kit/ui"));
  const gallery = await compile(`
    import { StrictMode, createElement as h } from "react";
    import { createRoot } from "react-dom/client";
    import { UiGallery, createGalleryClient } from ${ui};
    const params = new URLSearchParams(location.search);
    document.documentElement.dataset.theme = params.get("theme") || "light";
    const client = createGalleryClient();
    window.__gallery = { client };
    createRoot(document.getElementById("root")).render(
      h(StrictMode, null, h(UiGallery, { client, initialPage: params.get("page") || "travel", initialDialog: params.get("dialog") || null, detailOpen: params.get("detail") !== "0", initialTab: params.get("tab") || undefined })),
    );
  `);
  galleryHtml = viewPage(gallery);
  const host = await compile(`import { AppViewController } from ${JSON.stringify(require.resolve("@ri/app-kit/view-host"))}; window.AppViewController = AppViewController;`, false);
  hostHtml = `<!doctype html><html><body><div id="mount" style="height:600px"></div><script>${host}</script></body></html>`;
  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/" || url.pathname === "/gallery") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(galleryHtml);
    } else if (url.pathname === "/host") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(hostHtml);
    } else if (url.pathname === "/favicon.ico") {
      response.statusCode = 204;
      response.end();
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: browserPath(), headless: true, chromiumSandbox: true, env: { PATH: process.env.PATH ?? "", TMPDIR: process.env.TMPDIR ?? os.tmpdir() } });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

interface Watch { errors: string[]; foreign: string[] }
async function openGallery(width: number, query: Record<string, string>, height = 900): Promise<{ page: Page; watch: Watch }> {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
  const watch: Watch = { errors: [], foreign: [] };
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") watch.errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => watch.errors.push(`pageerror: ${error.message}`));
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith("data:")) watch.foreign.push(url);
  });
  await page.goto(`${origin}/?${new URLSearchParams(query)}`);
  await page.waitForSelector("main h1");
  await page.waitForTimeout(150);
  return { page, watch };
}

/** Elements whose box extends past the frame, ignoring content inside sideways scroll areas. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrolling = (element: Element) => {
      for (let node = element.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX === "auto" || style.overflowX === "scroll" || style.overflowX === "hidden") return true;
      }
      return false;
    };
    const offenders = [...document.querySelectorAll(".ri-app *")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.right > width + 1 && !scrolling(element) && !element.closest("dialog:not([open])");
      })
      .slice(0, 5)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className} right=${Math.round(element.getBoundingClientRect().right)}`);
    return { page: document.documentElement.scrollWidth - width, offenders };
  });
}

describe("UI kit gallery in Chromium", () => {
  it("lays out every page at 1280, 760, 390 and 360 px in light and dark without overflow or errors", async () => {
    const problems: string[] = [];
    for (const theme of THEMES)
      for (const width of WIDTHS)
        for (const name of PAGES) {
          const { page, watch } = await openGallery(width, { page: name, theme });
          const result = await overflow(page);
          if (result.page > 0 || result.offenders.length) problems.push(`${name} ${theme} ${width}: page overflow ${result.page}px ${result.offenders.join(", ")}`);
          if (watch.errors.length) problems.push(`${name} ${theme} ${width}: ${watch.errors.join(" | ")}`);
          if (watch.foreign.length) problems.push(`${name} ${theme} ${width}: external requests ${watch.foreign.join(", ")}`);
          expect(await page.evaluate(() => document.querySelectorAll("style[data-ri-ui]").length)).toBe(1);
          expect(await page.evaluate(() => document.querySelector(".ri-app")?.getAttribute("data-layout"))).toBe(width < 700 ? "narrow" : width < 1150 ? "medium" : "wide");
          await page.screenshot({ path: path.join(artifacts, `${name}-${theme}-${width}.png`), fullPage: true });
          await page.close();
        }
    // Every Travel section, narrow list screens and open dialogs.
    for (const width of WIDTHS) {
      for (const tab of ["bookings", "ideas", "review", "sources"] as const)
        for (const theme of width === 1280 || width === 360 ? THEMES : (["light"] as const)) {
          const { page, watch } = await openGallery(width, { page: "travel", tab, theme, detail: "0" });
          const result = await overflow(page);
          if (result.page > 0 || result.offenders.length) problems.push(`travel ${tab} ${theme} ${width}: ${result.page}px ${result.offenders.join(", ")}`);
          if (watch.errors.length) problems.push(`travel ${tab} ${theme} ${width}: ${watch.errors.join(" | ")}`);
          await page.screenshot({ path: path.join(artifacts, `travel-${tab}-${theme}-${width}.png`), fullPage: true });
          await page.close();
        }
      for (const name of ["travel", "jobs", "people"] as const) {
        const { page, watch } = await openGallery(width, { page: name, theme: "light", detail: "0" });
        const result = await overflow(page);
        if (result.page > 0 || result.offenders.length) problems.push(`${name} list ${width}: ${result.page}px ${result.offenders.join(", ")}`);
        if (watch.errors.length) problems.push(`${name} list ${width}: ${watch.errors.join(" | ")}`);
        await page.screenshot({ path: path.join(artifacts, `${name}-list-light-${width}.png`), fullPage: true });
        await page.close();
      }
      for (const dialog of ["followup", "correct"] as const)
        for (const theme of THEMES) {
          const { page, watch } = await openGallery(width, { page: "travel", theme, dialog });
          await page.waitForSelector("dialog[open]");
          const box = await page.locator("dialog[open]").boundingBox();
          if (!box || box.x < 0 || box.x + box.width > width + 1) problems.push(`dialog ${dialog} ${width}: outside the frame`);
          if (width < 700 && box && box.width < width - 1) problems.push(`dialog ${dialog} ${width}: not full screen at narrow width (${box.width}px)`);
          if (watch.errors.length) problems.push(`dialog ${dialog} ${width}: ${watch.errors.join(" | ")}`);
          await page.screenshot({ path: path.join(artifacts, `dialog-${dialog}-${theme}-${width}.png`) });
          await page.close();
        }
    }
    expect(problems).toEqual([]);
  }, 300_000);

  it("reaches the primary actions by keyboard with a visible focus ring", async () => {
    for (const width of [1280, 390]) {
      const { page, watch } = await openGallery(width, { page: "travel" });
      const seen: { text: string; ring: boolean }[] = [];
      for (let step = 0; step < 30; step++) {
        await page.keyboard.press("Tab");
        seen.push(await page.evaluate(() => {
          const element = document.activeElement as HTMLElement;
          const style = getComputedStyle(element);
          const text = element === document.body ? "(body)" : (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 60);
          return { text, ring: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2 };
        }));
      }
      const texts = seen.map((entry) => entry.text);
      expect(texts).toContain("Ask Ri");
      expect(texts).toContain("Add booking");
      expect(texts.indexOf("Ask Ri")).toBeLessThan(texts.indexOf("Add booking"));
      expect(texts).toContain("Itinerary");
      // Past the last control, focus leaves the document. Every control before that shows a ring.
      expect(seen.filter((entry) => !entry.ring && entry.text !== "(body)")).toEqual([]);
      expect(watch.errors).toEqual([]);
      await page.close();
    }
  }, 60_000);

  it("moves between section tabs with arrow keys, Home and End", async () => {
    const { page, watch } = await openGallery(1280, { page: "travel" });
    const selected = () => page.evaluate(() => ({ selected: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent, focused: document.activeElement?.textContent, panel: document.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby") === document.querySelector('[role="tab"][aria-selected="true"]')?.id }));
    await page.locator('[role="tab"][aria-selected="true"]').focus();
    await page.keyboard.press("ArrowRight");
    expect(await selected()).toEqual({ selected: "Bookings", focused: "Bookings", panel: true });
    await page.keyboard.press("End");
    expect(await selected()).toEqual({ selected: "Sources", focused: "Sources", panel: true });
    await page.keyboard.press("ArrowRight");
    expect((await selected()).selected).toBe("Itinerary");
    await page.keyboard.press("ArrowLeft");
    expect((await selected()).selected).toBe("Sources");
    await page.keyboard.press("Home");
    expect(await selected()).toEqual({ selected: "Itinerary", focused: "Itinerary", panel: true });
    // A narrow frame scrolls the tab row instead of overflowing the page.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(100);
    const tabs = await page.evaluate(() => {
      const list = document.querySelector(".ri-tabs__list")!;
      return { overflowing: list.scrollWidth > list.clientWidth, fade: document.querySelector(".ri-tabs")!.getAttribute("data-overflow-end"), page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(tabs).toEqual({ overflowing: true, fade: "true", page: 0 });
    await page.locator('[role="tab"][aria-selected="true"]').focus();
    await page.keyboard.press("End");
    const visible = await page.evaluate(() => {
      const tab = document.querySelector('[role="tab"][aria-selected="true"]')!.getBoundingClientRect();
      const list = document.querySelector(".ri-tabs__list")!.getBoundingClientRect();
      return tab.right <= list.right + 1 && tab.left >= list.left - 1;
    });
    expect(visible).toBe(true);
    expect(watch.errors).toEqual([]);
    await page.close();
  }, 60_000);

  it("traps focus in a dialog, closes on Escape, restores focus and reuses the invocation ID on retry", async () => {
    const { page, watch } = await openGallery(1280, { page: "travel" });
    const trigger = page.getByRole("button", { name: "Create follow-up" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector("dialog[open]");
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).value)).toBe("Check Riverside House arrival details");
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press(step % 3 === 2 ? "Shift+Tab" : "Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog[open]")))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog"));
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Create follow-up");

    // Create fails once, then "Try again" succeeds with the same invocation ID.
    await page.keyboard.press("Enter");
    await page.waitForSelector("dialog[open]");
    await page.getByRole("button", { name: "Create task" }).click();
    await page.getByText("Ri is busy right now. Try again.").waitFor();
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByRole("heading", { name: "Task created in Ri" }).waitFor();
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Done");
    const calls = await page.evaluate(() => (window as unknown as { __gallery: { client: { calls: { action: string; invocationId?: string; input: Record<string, unknown> }[] } } }).__gallery.client.calls.filter((call) => call.action === "create_follow_up"));
    expect(calls).toHaveLength(2);
    expect(calls[0].invocationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[1].invocationId).toBe(calls[0].invocationId);
    expect(calls[1].input).toEqual({ title: "Check Riverside House arrival details", dueAt: "2026-11-02", subjectId: "hotel" });
    await page.screenshot({ path: path.join(artifacts, "dialog-followup-created-light-1280.png") });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.querySelector("dialog"));
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Create follow-up");
    expect(watch.errors).toEqual([]);
    await page.close();
  }, 60_000);

  it("moves a stage with the keyboard menu and announces it", async () => {
    const { page, watch } = await openGallery(1280, { page: "jobs" });
    const trigger = page.getByRole("button", { name: "Move to stage" });
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForSelector('[role="menu"]');
    expect(await page.evaluate(() => [document.activeElement?.textContent, document.activeElement?.getAttribute("aria-checked")])).toEqual(["Interviewing", "true"]);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Move to stage");
    await page.keyboard.press("Enter");
    await page.waitForSelector('[role="menu"]');
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Offer");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('[role="status"][aria-live="polite"]')?.textContent === "Moved to Offer");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Move to stage");
    expect(await page.locator(".ri-inspector__subtitle").textContent()).toContain("Offer");
    // Typing a letter jumps to the matching stage.
    await page.keyboard.press("Enter");
    await page.keyboard.press("s");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Saved");
    await page.keyboard.press("Escape");
    expect(watch.errors).toEqual([]);
    await page.close();
  }, 60_000);

  it("opens a narrow record as its own screen and Back restores the list and focus", async () => {
    const { page, watch } = await openGallery(390, { page: "travel", detail: "0" });
    await page.getByRole("tab", { name: "Bookings" }).click();
    const card = page.locator(".ri-row-card", { hasText: "Riverside House" });
    await card.focus();
    await page.keyboard.press("Enter");
    const back = page.getByRole("button", { name: "Back to bookings" });
    await back.waitFor();
    expect(await page.locator(".ri-split__pane").isHidden()).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Riverside House");
    expect(await page.locator(".ri-inspector button[aria-label='Close details']").count()).toBe(0);
    await page.screenshot({ path: path.join(artifacts, "travel-detail-screen-light-390.png"), fullPage: true });
    await back.click();
    await page.locator(".ri-split__pane").waitFor();
    expect(await page.evaluate(() => document.activeElement?.closest(".ri-row-card")?.textContent?.includes("Riverside House"))).toBe(true);
    // Escape inside the detail screen also goes back.
    await page.keyboard.press("Enter");
    await back.waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".ri-split__pane").waitFor();
    // At wide widths the same selection opens beside the list.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator("tbody tr", { hasText: "Riverside House" }).click();
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.querySelector(".ri-split")?.getAttribute("data-mode"))).toBe("split");
    expect(await page.locator(".ri-split__pane").isVisible()).toBe(true);
    expect(await page.locator(".ri-inspector").isVisible()).toBe(true);
    expect(watch.errors).toEqual([]);
    await page.close();
  }, 60_000);

  it("selects table rows with arrow keys and Enter", async () => {
    const { page, watch } = await openGallery(1280, { page: "people", detail: "0" });
    await page.locator("tbody tr").first().focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const title = await page.locator(".ri-inspector__title").textContent();
    const current = await page.locator('tbody tr[aria-current="true"] .ri-avatar-label__name').textContent();
    expect(title).toBe(current);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("TR");
    await page.keyboard.press("End");
    await page.keyboard.press(" ");
    expect(await page.locator(".ri-inspector__title").textContent()).toBe(await page.locator("tbody tr").last().locator(".ri-avatar-label__name").textContent());
    // Sorting is a real button in the header with aria-sort.
    await page.getByRole("button", { name: "Name" }).click();
    expect(await page.locator("th[aria-sort='ascending']").textContent()).toBe("Name");
    expect(watch.errors).toEqual([]);
    await page.close();
  }, 60_000);

  it("confirms Delete imported data separately from Pause and Disconnect", async () => {
    for (const width of [1280, 360]) {
      const { page, watch } = await openGallery(width, { page: "travel" });
      await page.getByRole("tab", { name: "Sources" }).click();
      const card = page.locator("article.ri-account", { hasText: "Personal Gmail" });
      await card.getByRole("button", { name: "Delete imported data" }).click();
      await page.getByRole("heading", { name: "Delete imported data from Personal Gmail?" }).waitFor();
      expect(await page.locator("dialog[open]").textContent()).toContain("The account stays connected to Ri.");
      await page.screenshot({ path: path.join(artifacts, `dialog-delete-light-${width}.png`) });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("dialog"));
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Delete imported data");
      await card.getByRole("button", { name: "Pause updates" }).click();
      await page.waitForFunction(() => document.querySelector('[role="status"][aria-live="polite"]')?.textContent === "Updates paused for Personal Gmail");
      expect(watch.errors).toEqual([]);
      await page.close();
    }
  }, 60_000);

  it("drives the real MCP Apps bridge: drafts, context, location, retries and refresh", async () => {
    const guestScript = await compile(`
      import { createElement as h, useEffect, useRef } from "react";
      import { createRoot } from "react-dom/client";
      import { RiAppProvider, useRiApp, useQuery, useMutation } from ${JSON.stringify(require.resolve("@ri/app-kit/ui"))};
      function Probe() {
        const app = useRiApp();
        const list = useQuery("list_trips", { limit: 50 });
        const save = useMutation("save_trip");
        const started = useRef(false);
        useEffect(() => {
          if (!app.connected || !list.data || started.current) return;
          started.current = true;
          (async () => {
            await app.ask("Prepare me for Lisbon. 😀");
            for (let index = 0; index < 6; index++) app.context({ selected: ["trip-" + index] });
            app.setLocation("/trips/lisbon?tab=itinerary");
            app.setLocation("/trips/lisbon?tab=bookings");
            await app.openSources();
            await app.manageAccess();
            try { await save.run({ title: "Lisbon" }); } catch {}
            await save.run({ title: "Lisbon" });
            await new Promise((resolve) => setTimeout(resolve, 500));
            await app.call("report", { revision: app.revision, theme: document.documentElement.dataset.theme, data: app.data });
          })();
        }, [app.connected, list.data]);
        useEffect(() => {
          if (app.revision > 0) app.call("report_revision", { revision: app.revision, data: app.data, list: list.data ?? null });
        }, [app.revision, list.data]);
        return h("p", null, list.data ? "Loaded" : "Loading");
      }
      createRoot(document.getElementById("root")).render(h(RiAppProvider, null, h(Probe)));
    `, false);
    const guest = prepareHtml(`<html><body><div id="root"></div><script>${guestScript}</script></body></html>`);
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/host`);
    await page.evaluate(async ({ guest, id }) => {
      type State = { calls: { action: string; input: unknown; meta?: { invocationId?: string } }[]; contexts: unknown[]; paths: string[]; links: string[]; errors: string[]; saves: number; listCount: number; controller: unknown };
      const state = window as unknown as State & { AppViewController: new (mount: HTMLElement, callbacks: unknown) => { open(resource: unknown, binding: unknown): Promise<void> } };
      state.calls = []; state.contexts = []; state.paths = []; state.links = []; state.errors = []; state.saves = 0; state.listCount = 0;
      const controller = new state.AppViewController(document.getElementById("mount")!, {
        call: async (action: string, input: unknown, _signal: AbortSignal, meta?: { invocationId?: string }) => {
          state.calls.push({ action, input, meta });
          if (action === "list_trips") return { items: [{ id: "lisbon" }], page: ++state.listCount };
          if (action === "save_trip" && ++state.saves === 1) throw new Error("Temporary failure");
          return { ok: true };
        },
        context: async (envelope: unknown) => { state.contexts.push(envelope); },
        navigate: (value: string) => { state.paths.push(value); },
        externalLink: (url: string) => { state.links.push(url); },
        error: (error: Error) => state.errors.push(error.message),
      });
      state.controller = controller;
      await controller.open(guest, { id, packageDigest: "b".repeat(64), initialData: { trip: "lisbon", revision: 1 }, path: "/", query: {}, theme: "light" });
    }, { guest, id: randomUUID() });
    await page.waitForFunction(() => (window as unknown as { calls: { action: string }[] }).calls.some((call) => call.action === "report"), undefined, { timeout: 15_000 });
    // A changed refresh bumps the revision and refetches. An identical one does not.
    await page.evaluate(async () => {
      const controller = (window as unknown as { controller: { refresh(data: unknown): Promise<void>; theme(theme: string): void } }).controller;
      await controller.refresh({ trip: "lisbon", revision: 1 });
      await controller.refresh({ trip: "lisbon", revision: 2 });
      controller.theme("dark");
    });
    await page.waitForFunction(() => (window as unknown as { calls: { action: string; input: { list?: { page: number } } }[] }).calls.some((call) => call.action === "report_revision" && call.input.list?.page === 2), undefined, { timeout: 10_000 });
    const state = await page.evaluate(() => {
      const value = window as unknown as { calls: { action: string; input: unknown; meta?: { invocationId?: string } }[]; contexts: unknown[]; paths: string[]; errors: string[] };
      return { calls: value.calls, contexts: value.contexts, paths: value.paths, errors: value.errors };
    });
    expect(state.errors).toEqual([]);
    expect(state.paths).toEqual([
      `/__host/chat?prompt=${encodeURIComponent("Prepare me for Lisbon. 😀")}`,
      "/__host/sources",
      "/__host/manage-access",
      "/__host/location?to=%2Ftrips%2Flisbon%3Ftab%3Dbookings",
    ]);
    expect(state.contexts).toEqual([{ formatVersion: 1, revision: 1, state: { selected: ["trip-5"] } }]);
    const saves = state.calls.filter((call) => call.action === "save_trip");
    expect(saves).toHaveLength(2);
    expect(saves[0].meta?.invocationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(saves[1].meta?.invocationId).toBe(saves[0].meta?.invocationId);
    expect(state.calls.filter((call) => call.action === "list_trips").map((call) => call.meta)).toEqual([undefined, undefined]);
    const report = state.calls.find((call) => call.action === "report")!.input as { revision: number; theme: string; data: unknown };
    expect(report).toEqual({ revision: 0, theme: "light", data: { trip: "lisbon", revision: 1 } });
    const revisions = state.calls.filter((call) => call.action === "report_revision").map((call) => (call.input as { revision: number }).revision);
    expect(new Set(revisions)).toEqual(new Set([1]));
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);
});
