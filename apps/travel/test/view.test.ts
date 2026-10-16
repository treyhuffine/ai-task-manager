/**
 * Packaged view qualification. Imports the real catalog archive, runs its
 * packaged server through AppEngine, and drives the packaged dist/ui.html in
 * real Chrome through AppViewController, the same opaque relay Ri uses. Tool
 * calls reach the packaged server. Screenshots go to artifacts/ for review.
 * Requires `pnpm --filter ri-travel package` first. All data is fictional.
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
import { AppError, publicError, type AppPrincipal, type InvocationAccess } from "@ri/app-kit/contract";
import { AppEngine, NativeNodeDriver, type HostServices, type InstalledArtifact } from "@ri/app-kit/runtime";
import { importPackage, prepareHtml } from "@ri/app-kit/build";
import { fakeConnectors, gmailAccount, type GmailAccount } from "./helpers.js";
import * as fx from "../src/fixtures/messages.js";

const root = path.resolve(import.meta.dirname, "..");
const repository = path.resolve(root, "../..");
// TRAVEL_ARCHIVE points at an offline build (test/support/offline-archive.ts) while packaging is unavailable.
const archive = process.env.TRAVEL_ARCHIVE ? path.resolve(process.env.TRAVEL_ARCHIVE) : path.join(repository, "release/local-apps/dev-catalog/ri-travel.tar.gz");
const artifacts = path.join(root, "artifacts");
const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"].find(fs.existsSync);

type Principal = "owner" | "fixture";
const PRINCIPALS: Record<Principal, AppPrincipal> = { owner: { kind: "owner-ui", id: "owner" }, fixture: { kind: "fixture", id: "preview", fixtureAudience: "user" } };

interface World { engine: AppEngine; instance: InstalledArtifact; accounts: InvocationAccess["accounts"]; gmail: Record<string, GmailAccount>; delay: { action: string | null; ms: number }; fail: string | null }
const temporary: string[] = [];
let browser: Browser;
let server: http.Server;
let origin: string;
let hostScript: string;
const worlds = new Map<string, World>();
const writes = new Set<string>();

async function createWorld(name: string): Promise<World> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ri-travel-view-"));
  temporary.push(dir);
  const artifact = await importPackage(archive, path.join(dir, "package"));
  for (const action of artifact.contract.actions) if (action.effect !== "read") writes.add(action.name);
  const instanceId = randomUUID();
  const instance: InstalledArtifact = { ...artifact, instanceId, dataDir: path.join(dir, "data"), cacheDir: path.join(dir, "cache"), logsDir: path.join(dir, "logs") };
  for (const folder of [instance.dataDir, instance.cacheDir, instance.logsDir]) fs.mkdirSync(folder, { recursive: true });
  const gmail: Record<string, GmailAccount> = {};
  const tasks = new Map<string, { id: string; title: string }>();
  const connectors = fakeConnectors({ gmail, tasks });
  const world = { accounts: [] as InvocationAccess["accounts"], gmail, delay: { action: null as string | null, ms: 0 }, fail: null } as World;
  const services: HostServices = {
    version: 1,
    authorize(_instance, _action, context) {
      if (!["owner-ui", "fixture", "chat"].includes(context.principal.kind)) throw new AppError("forbidden", "Not in this test");
    },
    invocationAccess: (_instance, context) => ({ protocol: "ri-access-v1", actorId: `${context.principal.kind}:${context.principal.id}`, scopeRef: null, accounts: context.principal.kind === "owner-ui" ? world.accounts : [] }),
    async capability(_instance, _context, call) {
      return connectors(call.name, call.input as Record<string, unknown>, { binding: call.binding, account: call.account });
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
  if (!fs.existsSync(archive)) throw new Error("Run pnpm --filter ri-travel package first");
  if (!chrome) throw new Error("The packaged view test needs Chrome or Brave installed");
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
        navigate:(path)=>{state.links.push(path);if(path.startsWith('/__host/location?to='))state.location=decodeURIComponent(path.slice('/__host/location?to='.length));},
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
    try {
      if (request.method === "GET") { response.setHeader("Content-Type", "text/html"); response.end(page); return; }
      const input = await body(request);
      const world = worlds.get(String(input.world))!;
      const principal = PRINCIPALS[input.principal as Principal];
      if (request.url === "/call") {
        if (world.delay.action === input.action) await new Promise((resolve) => setTimeout(resolve, world.delay.ms));
        if (world.fail === input.action) {
          world.fail = null;
          response.end(JSON.stringify({ error: { code: "app_failed", message: "The app could not complete this operation. Check its activity and retry." } }));
          return;
        }
        try {
          const result = await world.engine.invoke(world.instance, String(input.action), input.input, principal, 0, typeof input.invocationId === "string" ? input.invocationId : undefined);
          let refresh: unknown = null;
          // Like Ri, a refresh re-runs the opener with the path the view opened at.
          if (writes.has(String(input.action))) refresh = ((await world.engine.invoke(world.instance, "open_view", locationQuery(String(input.opened ?? "/")), principal, 0)) as { data: unknown }).data;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ result, refresh }));
        } catch (error) {
          response.end(JSON.stringify({ error: publicError(error) }));
        }
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: { code: "app_failed", message: String(error) } }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: chrome, headless: true, chromiumSandbox: true, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR } });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  for (const world of worlds.values()) await world.engine.stop(world.instance.instanceId).catch(() => undefined);
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function open(world: World, name: string, principal: Principal, location: string, size: { width: number; height: number }, theme: "light" | "dark" = "light") {
  const page = await browser.newPage({ viewport: size });
  const external: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => { if (!request.url().startsWith(origin) && !request.url().startsWith("data:") && request.url() !== "about:srcdoc") external.push(request.url()); });
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto(origin);
  const opened = (await world.engine.invoke(world.instance, "open_view", locationQuery(location), PRINCIPALS[principal], 0)) as { data: unknown };
  const guest = prepareHtml(fs.readFileSync(path.join(world.instance.packageDir, "dist/ui.html"), "utf8"));
  await page.evaluate(([location]) => { const target = (window as unknown as { __state: { location: string; opened: string } }).__state; target.location = location; target.opened = location; }, [location]);
  await page.evaluate(async ({ guest, binding, name, principal }) => {
    await (window as unknown as { startView(guest: unknown, binding: unknown, world: string, principal: string): Promise<void> }).startView(guest, binding, name, principal);
  }, { guest, binding: { id: randomUUID(), packageDigest: world.instance.digest, initialData: opened.data, path: locationQuery(location).path, query: locationQuery(location).query, theme, files: world.instance.manifest.extensions["com.ri"].requests.files }, name, principal });
  // The guest is the frame inside the relay frame. Wait until it has rendered.
  let frame: Frame | undefined;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    frame = page.frames().find((item) => item.parentFrame() && item.parentFrame() !== page.mainFrame());
    if (frame && (await frame.locator("#root > *").count().catch(() => 0)) > 0) break;
    await page.waitForTimeout(100);
  }
  if (!frame || (await frame.locator("#root > *").count().catch(() => 0)) === 0) throw new Error(`The Travel view did not render: ${JSON.stringify({ consoleErrors, frames: page.frames().map((item) => item.url()) })}`);
  if (process.env.TRAVEL_DEBUG) {
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(artifacts, `debug-${name}.png`) });
    fs.writeFileSync(path.join(os.tmpdir(), `travel-debug-${name}.json`), JSON.stringify({ state: await state(page), consoleErrors, external }, null, 1));
  }
  return { page, frame, external, consoleErrors };
}
const state = (page: Page) => page.evaluate(() => (window as unknown as { __state: { links: string[]; contexts: { state: Record<string, unknown> }[]; errors: string[]; calls: string[]; location: string } }).__state);
async function shot(page: Page, file: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(artifacts, file), fullPage: false });
}
async function noOverflow(frame: Frame) {
  const widths = await frame.locator("html").evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
}

describe("packaged Travel view", () => {
  it("previews the fictional Lisbon trip, opens a booking, accepts a change, stages Ask Ri without sending and adapts to every width", async () => {
    const world = await createWorld("preview");
    const { page, frame, external, consoleErrors } = await open(world, "preview", "fixture", "/", { width: 1280, height: 1000 });
    await expect.poll(() => frame.getByRole("heading", { level: 1 }).textContent(), { timeout: 20_000 }).toBe("Lisbon");
    await frame.getByRole("radio", { name: /Tue\s*10/ }).click();
    await expect.poll(() => frame.getByText("Arrive in Lisbon").count()).toBeGreaterThan(0);
    await expect.poll(() => frame.getByText("Local times in Lisbon WET").count()).toBeGreaterThan(0);
    await noOverflow(frame);
    await shot(page, "travel-1280-itinerary.png");

    // Select the hotel: the inspector shows source-backed details beside the itinerary.
    await frame.getByRole("button", { name: /Riverside House\s+Check in, 4 nights/ }).click();
    await expect.poll(() => frame.getByText("Stay details").count()).toBe(1);
    await expect.poll(() => frame.getByText("Nov 10, 2026, 15:00 WET").count()).toBeGreaterThan(0);
    await expect.poll(async () => (await state(page)).contexts.some((envelope) => JSON.stringify(envelope.state).includes('"type":"booking"'))).toBe(true);
    await shot(page, "travel-1280-inspector.png");

    // The chat context names the booking and the backend resolves it under the caller's access.
    const latest = (await state(page)).contexts.at(-1)!;
    const context = (await world.engine.invoke(world.instance, "describe_view_context", { path: "/", query: {}, state: latest.state }, PRINCIPALS.fixture, 0)) as { modelContent: string; recordRefs: { recordId: string }[] };
    const bookingId = ((latest.state.selected as { id: string }[])[0]).id;
    expect(context.modelContent).toContain(`[booking ${bookingId}`);
    expect(context.modelContent).toContain("Riverside House");

    // Ask Ri stages a prompt in the native composer and never sends.
    const callsBefore = (await state(page)).calls.length;
    await frame.getByRole("button", { name: "Ask about this booking" }).click();
    await expect.poll(async () => (await state(page)).links.some((link) => link.startsWith("/__host/chat?prompt="))).toBe(true);
    const chatLinks = (await state(page)).links.filter((link) => link.startsWith("/__host/chat"));
    expect(chatLinks).toHaveLength(1);
    expect(decodeURIComponent(chatLinks[0].split("prompt=")[1])).toBe("Check Riverside House against my Lisbon trip. Are all of my nights covered?");
    expect((await state(page)).calls.slice(callsBefore).filter((name) => !["get_booking", "get_trip", "list_trips", "get_evidence", "remember_view"].includes(name))).toEqual([]);

    // Open directions goes to an external map through the host. Nothing loads inside the view.
    await frame.getByRole("button", { name: "Open directions" }).click();
    await expect.poll(async () => (await state(page)).links.some((link) => link.startsWith("https://www.google.com/maps/search/?api=1&query=Rua%20da%20Prata"))).toBe(true);

    // Open the source evidence.
    await frame.getByRole("button", { name: "Open source" }).first().click();
    await expect.poll(() => frame.getByRole("dialog").count()).toBe(1);
    await expect.poll(() => frame.getByText(/Fictional example source/).count()).toBeGreaterThan(0);
    await shot(page, "travel-1280-source.png");
    await frame.getByRole("button", { name: "Done" }).click();

    // Review the revised check-in, accept it, and see the itinerary refresh.
    await frame.getByRole("button", { name: "Review change" }).click();
    await expect.poll(() => frame.getByRole("heading", { level: 1 }).textContent()).toBe("Review");
    await expect.poll(() => frame.getByText("Your saved value").count()).toBeGreaterThan(0);
    await noOverflow(frame);
    await shot(page, "travel-1280-review.png");
    await frame.getByRole("button", { name: "Use 16:00" }).click();
    await expect.poll(() => frame.getByText("Riverside House changed").count(), { timeout: 10_000 }).toBe(0);
    await frame.getByRole("button", { name: "Back to Lisbon" }).click();
    await frame.getByRole("radio", { name: /Tue\s*10/ }).click();
    await expect.poll(() => frame.locator(".tr-entry", { hasText: "Riverside House" }).first().locator(".tr-entry__time strong").textContent(), { timeout: 10_000 }).toBe("16:00");

    // Bookings table and filters.
    await frame.getByRole("tab", { name: /Bookings/ }).click();
    await expect.poll(() => frame.getByRole("table").count()).toBe(1);
    await shot(page, "travel-1280-bookings.png");
    // Ideas and comparison without ratings or sums across currencies.
    await frame.getByRole("tab", { name: /Ideas/ }).click();
    await frame.locator(".tr-idea", { hasText: "Sintra day tour" }).getByLabel("Compare").check();
    await frame.locator(".tr-idea", { hasText: "Fado evening in Alfama" }).getByLabel("Compare").check();
    await shot(page, "travel-1280-ideas.png");
    await frame.getByRole("button", { name: /Compare 2 ideas/ }).click();
    await expect.poll(() => frame.getByText("They are not converted or added together", { exact: false }).count()).toBeGreaterThan(0);
    await shot(page, "travel-1280-compare.png");
    await frame.getByRole("button", { name: "Done" }).click();

    // Export through the host's download control.
    await frame.getByRole("tab", { name: /Itinerary/ }).click();
    await frame.getByRole("button", { name: "Export" }).click();
    await frame.getByRole("menuitem", { name: "Itinerary as CSV" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __state: { downloads: { resource: { uri: string; text: string } }[][] } }).__state.downloads.map((item) => item[0].resource.uri))).toEqual(["file:///travel-lisbon.csv"]);

    // Dark theme.
    await frame.getByRole("tab", { name: /Itinerary/ }).click();
    await page.evaluate(() => (window as unknown as { controller: { theme(theme: string): void } }).controller.theme("dark"));
    await shot(page, "travel-1280-dark.png");
    await page.evaluate(() => (window as unknown as { controller: { theme(theme: string): void } }).controller.theme("light"));

    // Medium, phone and companion widths: one column, and a booking opens as its own screen with Back.
    for (const [width, height] of [[760, 1000], [390, 844], [360, 760]] as const) {
      await page.setViewportSize({ width, height });
      await frame.getByRole("radio", { name: /Tue\s*10/ }).click();
      await page.waitForTimeout(200);
      await noOverflow(frame);
      await shot(page, `travel-${width}-itinerary.png`);
      await frame.getByRole("button", { name: /Arrive in Lisbon/ }).click();
      await expect.poll(() => frame.getByRole("button", { name: "Back to itinerary" }).count()).toBe(1);
      await noOverflow(frame);
      await shot(page, `travel-${width}-detail.png`);
      await frame.getByRole("button", { name: "Back to itinerary" }).click();
      await expect.poll(() => frame.getByRole("button", { name: "Back to itinerary" }).count()).toBe(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await frame.getByRole("button", { name: "Back to all trips" }).click();
    await expect.poll(() => frame.getByRole("heading", { level: 1 }).textContent()).toBe("Trips");
    await noOverflow(frame);
    await shot(page, "travel-390-trips.png");
    await page.setViewportSize({ width: 1280, height: 1000 });
    await frame.getByRole("tab", { name: "Sources" }).click();
    await expect.poll(() => frame.getByRole("heading", { level: 1 }).textContent()).toBe("Sources");
    await shot(page, "travel-1280-sources.png");

    expect(external).toEqual([]);
    expect((await state(page)).errors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await page.close();
  }, 180_000);

  it("starts empty when installed, adds a pasted booking, and shows loading, import progress and reconnect states honestly", async () => {
    const world = await createWorld("installed");
    const { page, frame, consoleErrors } = await open(world, "installed", "owner", "/", { width: 1280, height: 900 });
    await expect.poll(() => frame.getByRole("heading", { name: "Bring your next trip together" }).count(), { timeout: 20_000 }).toBe(1);
    await expect.poll(() => frame.getByRole("button", { name: "Connect email" }).count()).toBe(1);
    await shot(page, "travel-1280-empty.png");
    await page.setViewportSize({ width: 360, height: 760 });
    await noOverflow(frame);
    await shot(page, "travel-360-empty.png");
    await page.setViewportSize({ width: 1280, height: 900 });

    // Add a booking from pasted text: preview, then apply once.
    await frame.getByRole("button", { name: "Add booking" }).first().click();
    await frame.getByLabel("Confirmation text").fill(`Subject: ${fx.LISBON_HOTEL.subject}\n\n${fx.LISBON_HOTEL.text}`);
    await frame.getByRole("button", { name: "Preview" }).click();
    await expect.poll(() => frame.getByText(/Riverside House, November 10 to 14, 2026/).count(), { timeout: 10_000 }).toBeGreaterThan(0);
    await shot(page, "travel-1280-import-preview.png");
    await frame.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => frame.getByRole("heading", { level: 1 }).textContent(), { timeout: 10_000 }).toBe("Lisbon");
    const applied = (await state(page)).calls.filter((name) => name === "apply_import");
    expect(applied).toHaveLength(1);

    // Loading: a slow trip read shows a calm loading state, not an empty trip.
    world.delay = { action: "get_trip", ms: 1500 };
    await frame.getByRole("button", { name: "Back to all trips" }).click();
    await frame.getByRole("button", { name: /Lisbon/ }).first().click();
    await expect.poll(() => frame.getByText("Loading trip").count()).toBe(1);
    await shot(page, "travel-1280-loading.png");
    world.delay = { action: null, ms: 0 };
    await expect.poll(() => frame.getByText("Riverside House").count(), { timeout: 10_000 }).toBeGreaterThan(0);

    // Error: a failed read shows the reason and a retry, never an empty trip.
    world.fail = "get_trip";
    await frame.getByRole("button", { name: "Back to all trips" }).click();
    await frame.getByRole("button", { name: /Lisbon/ }).first().click();
    await expect.poll(() => frame.getByRole("button", { name: "Try again" }).count(), { timeout: 10_000 }).toBe(1);
    await shot(page, "travel-1280-error.png");
    await frame.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => frame.getByText("Riverside House").count(), { timeout: 10_000 }).toBeGreaterThan(0);

    // Import in progress, then an account that needs reconnecting. Imported records stay visible.
    world.gmail["acct-1"] = gmailAccount([{ id: "m1", subject: fx.LISBON_FLIGHT.subject, from: fx.LISBON_FLIGHT.from, receivedAt: fx.LISBON_FLIGHT.receivedAt, text: fx.LISBON_FLIGHT.text }]);
    world.accounts = [{ account: "acct-1", binding: "mail", actions: ["gmail.search_messages", "gmail.read_message"], automatic: true }];
    for (let step = 0; step < 2; step++) await world.engine.invoke(world.instance, "continue_import", { source: "account:acct-1", kind: "mail" }, PRINCIPALS.owner, 0);
    await page.close();
    const progress = await open(world, "installed", "owner", "/trips", { width: 1280, height: 900 });
    await expect.poll(() => progress.frame.getByText("Import in progress.").count(), { timeout: 20_000 }).toBe(1);
    await shot(progress.page, "travel-1280-partial.png");
    await progress.frame.getByRole("tab", { name: "Sources" }).click();
    await expect.poll(() => progress.frame.getByText("Importing").count()).toBeGreaterThan(0);
    await shot(progress.page, "travel-1280-sources-importing.png");
    world.gmail["acct-1"].revoked = true;
    await world.engine.invoke(world.instance, "continue_import", { source: "account:acct-1", kind: "mail" }, PRINCIPALS.owner, 0);
    await progress.page.close();
    const reconnect = await open(world, "installed", "owner", "/trips", { width: 1280, height: 900 });
    await expect.poll(() => reconnect.frame.getByText("Reconnect email to keep trips up to date.").count(), { timeout: 20_000 }).toBe(1);
    await expect.poll(() => reconnect.frame.getByText("Lisbon").count()).toBeGreaterThan(0);
    await shot(reconnect.page, "travel-1280-reconnect.png");
    await reconnect.frame.getByRole("tab", { name: "Sources" }).click();
    await expect.poll(() => reconnect.frame.getByText("Reconnect needed").count()).toBeGreaterThan(0);
    await shot(reconnect.page, "travel-1280-sources-reconnect.png");
    expect(consoleErrors).toEqual([]);
    expect(reconnect.consoleErrors).toEqual([]);
    await reconnect.page.close();
  }, 180_000);
});
