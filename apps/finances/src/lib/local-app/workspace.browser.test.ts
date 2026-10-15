import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import { prepareHtml } from "@ri/app-kit/build";
import { createTestHome } from "@/test/fixtures/home";
import { seedSyntheticFinance } from "@/lib/finance/synthetic";
import * as q from "@/lib/db/queries";
import { getRawDb } from "@/lib/db";
import { toolsDefinition } from "./definition";
import { initializeManaged, shutdownManaged } from "./managed";
import { financeHomeHtml } from "./home-renderer";
const executablePath = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
].find(existsSync);
it.skipIf(!executablePath)(
  "uses the real MCP bridge for the workspace, exact inputs, drafts, previews and narrow layouts",
  async () => {
    const home = await createTestHome({ prefix: "finance-workspace-browser-" });
    initializeManaged("00000000-0000-4000-8000-000000000001", null);
    const fixture = seedSyntheticFinance(q.financeOwner);
    const tools = toolsDefinition();
    const call = async (name: string, input: unknown = {}) =>
      tools.find((t) => t.name === name)!.run(q.financeOwner, input);
    const initial = (await call("finance_open_app", {
      path: "/",
      query: {},
    })) as { data: unknown; scope: { actions: string[] } };
    const prepared = prepareHtml(financeHomeHtml());
    const policy =
      "default-src 'none'; script-src " +
      prepared.scriptHashes.join(" ") +
      "; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";
    const guest = prepared.html.replace(
      "<head>",
      '<head><meta http-equiv="Content-Security-Policy" content="' +
        policy +
        '">',
    );
    const resolve = createRequire(import.meta.url).resolve;
    const source = `import {AppBridge,PostMessageTransport} from ${JSON.stringify(resolve("@modelcontextprotocol/ext-apps/app-bridge"))};
  (async()=>{const frame=document.getElementById('guest');const bridge=new AppBridge(null,{name:'Workspace reference',version:'1'},{serverTools:{},updateModelContext:{},openLinks:{}},{hostContext:{theme:'light',displayMode:'inline',availableDisplayModes:['inline']}});
  window.navigationRequests=[];window.contexts=[];
  bridge.oncalltool=async(params)=>{const r=await fetch('/call',{method:'POST',body:JSON.stringify(params)});return r.json();};
  bridge.onupdatemodelcontext=async(params)=>{window.contexts.push(JSON.parse(params.content[0].text));return {};};
  bridge.onopenlink=async(params)=>{window.navigationRequests.push(params.url);return {};};
  bridge.oninitialized=()=>bridge.sendToolResult({content:[],structuredContent:${JSON.stringify(initial.data)}});
  window.refreshFinance=async()=>{const r=await fetch('/refresh');await bridge.sendToolResult({content:[],structuredContent:await r.json()});};
  window.setFinanceTheme=async(theme)=>bridge.sendHostContextChange({theme});
  await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));frame.srcdoc=${JSON.stringify(guest)};})();`;
    const bundle = await build({
      stdin: { contents: source, resolveDir: process.cwd() },
      bundle: true,
      format: "iife",
      write: false,
      platform: "browser",
      target: "es2023",
    });
    const html =
      '<html><head><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0;display:block}</style></head><body><iframe id="guest" sandbox="allow-scripts"></iframe><script>' +
      bundle.outputFiles[0].text.replaceAll("</script", "<\\/script") +
      "</script></body></html>";
    const server = http.createServer((req, res) => {
      void (async () => {
        if (req.url === "/refresh") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(await call("finance_home")));
          return;
        }
        if (req.url === "/call") {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const input = JSON.parse(Buffer.concat(chunks).toString());
          res.setHeader("Content-Type", "application/json");
          try {
            if (!initial.scope.actions.includes(input.name))
              throw new Error("Action outside opened view");
            const value = await call(input.name, input.arguments);
            res.end(JSON.stringify({ content: [], structuredContent: value }));
          } catch (e) {
            res.end(
              JSON.stringify({
                isError: true,
                content: [
                  {
                    type: "text",
                    text: e instanceof Error ? e.message : String(e),
                  },
                ],
              }),
            );
          }
          return;
        }
        res.setHeader("Content-Type", "text/html");
        res.end(html);
      })().catch((e) => {
        res.statusCode = 500;
        res.end(String(e));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await chromium.launch({ headless: true, executablePath });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1080 },
      });
      const failures: string[] = [];
      page.on("pageerror", (e) => failures.push(e.message));
      await page.goto(
        "http://127.0.0.1:" + (server.address() as { port: number }).port,
      );
      const frame = page.frameLocator("#guest");
      await frame
        .getByRole("heading", { name: "Money in. Money out." })
        .waitFor();
      await frame.getByText("$5,000.00", { exact: true }).first().waitFor();
      expect(await frame.locator("body").innerText()).not.toContain(
        "minor units",
      );
      await fs.mkdir("artifacts", { recursive: true });
      await page.screenshot({
        path: "artifacts/workspace-overview.png",
        fullPage: true,
      });
      await frame.getByRole("button", { name: /Dining/ }).click();
      await frame
        .getByRole("heading", { name: "Every transaction, in context." })
        .waitFor();
      expect(await frame.getByLabel("Category filter").inputValue()).toBe(
        "dining",
      );
      await frame.getByLabel("Search merchants").fill("cafe");
      await frame
        .getByRole("button", { name: "View Fictional cafe", exact: true })
        .waitFor();
      await frame
        .getByRole("button", { name: "View Fictional cafe", exact: true })
        .click();
      await frame
        .getByRole("heading", { name: "Transaction details" })
        .waitFor();
      await frame
        .getByLabel("Category", { exact: true })
        .fill("A draft category");
      await page.evaluate(() =>
        (
          window as unknown as { refreshFinance: () => Promise<void> }
        ).refreshFinance(),
      );
      expect(
        await frame.getByLabel("Category", { exact: true }).inputValue(),
      ).toBe("A draft category");
      await frame
        .getByRole("button", { name: "Ask about this transaction" })
        .click();
      await page.waitForFunction(() =>
        (
          window as unknown as { navigationRequests: string[] }
        ).navigationRequests.some((v) => v.startsWith("/__host/chat?prompt=")),
      );
      const context = await page.evaluate(
        () =>
          (window as unknown as { contexts: { state: unknown }[] }).contexts.at(
            -1,
          )!.state,
      );
      await expect(
        call("finance_describe_view_context", {
          path: "/",
          query: {},
          state: context,
        }),
      ).resolves.toMatchObject({
        recordRefs: [expect.objectContaining({ entityType: "transaction" })],
      });
      await frame.getByRole("button", { name: "Close dialog" }).click();
      await frame
        .getByRole("button", { name: "Accounts", exact: true })
        .click();
      await frame
        .getByRole("button", { name: "Add account", exact: true })
        .click();
      await frame.getByLabel("Account name").fill("Everyday checking");
      await frame
        .getByLabel("Current balance", { exact: true })
        .fill("1234.56");
      await frame
        .getByRole("dialog")
        .getByRole("button", { name: "Add account", exact: true })
        .click();
      await frame
        .getByRole("heading", { name: "Everyday checking", exact: true })
        .waitFor();
      const account = q
        .listFinanceAccounts(q.financeOwner)
        .find((a) => a.name === "Everyday checking")!;
      expect(account.balanceMinor).toBe(123456);
      await frame
        .getByRole("button", { name: "Import CSV", exact: true })
        .click();
      const month = new Date().toLocaleDateString("en-CA").slice(0, 7);
      await frame
        .getByLabel("Or paste CSV")
        .fill(
          "date,merchant,amount,category,kind\n" +
            month +
            "-03,Neighborhood Market,42.19,groceries,purchase",
        );
      await frame
        .getByRole("button", { name: "Preview import", exact: true })
        .click();
      await frame
        .getByRole("heading", { name: "1 transactions ready to import" })
        .waitFor();
      const scope = {
        accountIds: [account.id],
        startOn: month + "-01",
        endOn: fixture.budget.plan.endOn,
      };
      expect(q.financeActivity(q.financeOwner, scope).total).toBe(0);
      await frame
        .getByRole("button", { name: "Import 1 transactions", exact: true })
        .click();
      await frame.getByRole("dialog").waitFor({ state: "hidden" });
      expect(q.financeActivity(q.financeOwner, scope).rows[0].amountMinor).toBe(
        4219,
      );
      await frame.getByRole("button", { name: "Budget", exact: true }).click();
      await frame
        .getByRole("button", { name: "Adjust plan", exact: true })
        .waitFor();
      const before = q.getFinanceBudget(q.financeOwner, fixture.budget.id);
      await frame
        .getByRole("button", { name: "Adjust plan", exact: true })
        .click();
      await frame.getByLabel("Dining", { exact: true }).fill("275.00");
      await frame
        .getByRole("button", { name: "Preview changes", exact: true })
        .click();
      await frame.getByText("Preview only", { exact: true }).waitFor();
      expect(
        q.getFinanceBudget(q.financeOwner, fixture.budget.id).revision,
      ).toBe(before.revision);
      await page.screenshot({
        path: "artifacts/workspace-budget-preview.png",
        fullPage: true,
      });
      await frame
        .getByRole("button", { name: "Apply reviewed changes", exact: true })
        .click();
      await frame.getByRole("dialog").waitFor({ state: "hidden" });
      expect(
        q
          .getFinanceBudget(q.financeOwner, fixture.budget.id)
          .plan.categories.find((c) => c.id === "dining")!.limitMinor,
      ).toBe(27500);
      await frame
        .getByRole("button", { name: "Overview", exact: true })
        .click();
      await frame
        .getByRole("heading", { name: "Money in. Money out." })
        .waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: "artifacts/workspace-mobile.png",
        fullPage: true,
      });
      expect(
        await frame
          .locator("html")
          .evaluate((e) => e.scrollWidth <= e.clientWidth),
      ).toBe(true);
      await page.evaluate(() =>
        (
          window as unknown as {
            setFinanceTheme: (theme: string) => Promise<void>;
          }
        ).setFinanceTheme("dark"),
      );
      await frame.locator('html[data-theme="dark"]').waitFor();
      await expect
        .poll(() =>
          frame
            .getByRole("button", { name: "Add account", exact: true })
            .evaluate((e) => getComputedStyle(e).backgroundColor),
        )
        .toBe("rgb(29, 29, 29)");
      await page.screenshot({
        path: "artifacts/workspace-dark.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1080 });
      await page.screenshot({
        path: "artifacts/workspace-dark-desktop.png",
        fullPage: true,
      });
      // A newly connected account has no budget. Keep this separate from the
      // populated fixture so the empty state cannot dereference missing data.
      getRawDb().prepare("DELETE FROM finance_budgets").run();
      await page.evaluate(() =>
        (
          window as unknown as { refreshFinance: () => Promise<void> }
        ).refreshFinance(),
      );
      await frame.getByRole("button", { name: "Budget", exact: true }).click();
      await frame
        .getByRole("heading", { name: "Give your money a plan" })
        .waitFor();
      await frame
        .getByRole("button", { name: "Create a budget", exact: true })
        .waitFor();
      expect(failures).toEqual([]);
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      shutdownManaged();
      await home.cleanup();
    }
  },
  90000,
);
