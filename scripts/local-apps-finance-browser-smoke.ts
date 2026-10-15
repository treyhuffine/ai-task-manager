/** Synthetic records only. Run through pnpm iso on a dedicated disposable Home. */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { chromium, type FrameLocator } from "playwright-core";

async function main() {
  const root = process.env.RI_ROOT;
  assert(
    root &&
      !["ri", "ri-dev", "ri-test"].some(
        (name) => path.resolve(root) === path.join(os.homedir(), name),
      ),
    "Use a disposable Home",
  );
  const config = JSON.parse(
    await fs.readFile(path.join(root, ".config/config.json"), "utf8"),
  );
  assert.equal(config.globalSkillEnabled, false);
  const base =
    process.env.RI_LOCAL_APPS_BROWSER_URL ?? "http://127.0.0.1:42251";
  assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
  async function rpc(name: string, input: unknown = {}, mutation = false) {
    const response = await fetch(
      base +
        "/api/trpc/" +
        name +
        (mutation ? "" : "?input=" + encodeURIComponent(JSON.stringify(input))),
      {
        method: mutation ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + config.localToken,
          "Content-Type": "application/json",
        },
        ...(mutation ? { body: JSON.stringify(input) } : {}),
      },
    );
    const value = await response.json();
    assert(
      response.ok && !value.error,
      name + ": " + (value.error?.message ?? "Request failed"),
    );
    return value.result.data;
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ].find(existsSync),
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
  });
  page.setDefaultTimeout(30000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  async function guest(
    heading = "Your money, in view.",
  ): Promise<FrameLocator> {
    const frame = page
      .frameLocator('iframe[aria-label="App view"]')
      .frameLocator("iframe");
    await frame
      .getByRole("heading", { name: heading, exact: true })
      .waitFor({ timeout: 60000 });
    return frame;
  }
  try {
    await page.goto(
      base + "/apps#token=" + encodeURIComponent(config.localToken),
    );
    let instance = (await rpc("localApps.list")).instances.find(
      (a: { packageId: string }) => a.packageId === "ri-finance",
    );
    if (!instance) {
      const card = page.locator("article").filter({
        has: page.getByRole("heading", { name: "Finances", exact: true }),
      });
      await card
        .getByRole("button", { name: /Preview app|Continue setup/ })
        .click({ timeout: 120000 });
      await page
        .getByRole("button", { name: "Use app", exact: true })
        .waitFor({ timeout: 120000 });
      await guest();
      await page.getByRole("button", { name: "Use app", exact: true }).click();
      await page
        .getByRole("button", { name: "Change app", exact: true })
        .waitFor({ timeout: 60000 });
      instance = (await rpc("localApps.list")).instances.find(
        (a: { packageId: string }) => a.packageId === "ri-finance",
      );
    } else {
      const card = page.locator("article").filter({
        has: page.getByRole("heading", { name: "Finances", exact: true }),
      });
      await card.waitFor();
      if (
        await card
          .getByRole("button", { name: "Review update", exact: true })
          .count()
      ) {
        const before = await rpc(
          "localApps.invoke",
          {
            id: instance.id,
            action: "finance_home",
            input: {},
            invocationId: crypto.randomUUID(),
          },
          true,
        );
        await card
          .getByRole("button", { name: "Review update", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Use app", exact: true })
          .waitFor({ timeout: 120000 });
        await guest();
        await page
          .getByRole("button", { name: "Use app", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Change app", exact: true })
          .waitFor({ timeout: 60000 });
        const after = await rpc(
          "localApps.invoke",
          {
            id: instance.id,
            action: "finance_home",
            input: {},
            invocationId: crypto.randomUUID(),
          },
          true,
        );
        assert.deepEqual(
          after.accounts.map((a: { id: string }) => a.id),
          before.accounts.map((a: { id: string }) => a.id),
          "Update lost accounts",
        );
      } else await page.goto(base + "/apps/" + instance.slug);
    }
    assert(instance);
    const invoke = (action: string, input: unknown = {}) =>
      rpc(
        "localApps.invoke",
        { id: instance.id, action, input, invocationId: crypto.randomUUID() },
        true,
      );
    let frame = await guest();
    if (!(await invoke("finance_home")).accounts.length) {
      await frame
        .getByRole("button", { name: "Add your first account", exact: true })
        .click();
      await frame.getByLabel("Account name").fill("Browser fixture checking");
      await frame
        .getByLabel("Current balance", { exact: true })
        .fill("4250.00");
      await frame
        .getByRole("dialog")
        .getByRole("button", { name: "Add account", exact: true })
        .click();
      await frame.getByRole("dialog").waitFor({ state: "hidden" });
    }
    await frame.getByRole("button", { name: "Accounts", exact: true }).click();
    await frame
      .getByRole("heading", { name: "Browser fixture checking", exact: true })
      .waitFor();
    const account = (await invoke("finance_home")).accounts.find(
      (a: { name: string }) => a.name === "Browser fixture checking",
    );
    assert.equal(account.balanceMinor, 425000);
    const month = new Date().toLocaleDateString("en-CA").slice(0, 7);
    const csv =
      "date,merchant,amount,category,kind\n" +
      month +
      "-01,Fixture payroll,-5000,income,income\n" +
      month +
      "-02,Fixture rent,1800,fixed,purchase\n" +
      month +
      "-03,Fixture Shop,24,shopping,purchase\n" +
      month +
      "-04,Fixture Market,31,groceries,purchase\n" +
      month +
      "-05,Fixture Cafe,18.50,dining,purchase";
    await frame
      .getByRole("button", { name: "Import CSV", exact: true })
      .click();
    await frame
      .getByRole("button", { name: "Choose file", exact: true })
      .click();
    await page.getByLabel("Select app file").setInputFiles({
      name: "fixture.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => document.body.style.pointerEvents !== "none",
    );
    await frame.getByText("fixture.csv", { exact: true }).waitFor();
    await frame
      .getByLabel("Or paste CSV")
      .inputValue()
      .then((value) => assert.match(value, /Fixture Shop/));
    await frame
      .getByRole("button", { name: "Preview import", exact: true })
      .click();
    await frame
      .getByRole("heading", {
        name: "5 transactions ready to import",
        exact: true,
      })
      .waitFor();
    await frame
      .getByRole("button", { name: "Import 5 transactions", exact: true })
      .click();
    await frame.getByRole("dialog").waitFor({ state: "hidden" });
    await frame.getByRole("button", { name: "Overview", exact: true }).click();
    await frame.getByText("$5,000.00", { exact: true }).first().waitFor();
    await page.screenshot({
      path: path.join(root, "finances-overview-in-ri.png"),
      fullPage: true,
    });
    await frame
      .getByRole("button", { name: "Transactions", exact: true })
      .click();
    await frame
      .getByRole("button", { name: "View Fixture Shop", exact: true })
      .click();
    await frame
      .getByLabel("Category", { exact: true })
      .fill("Unsaved category draft");
    await page.waitForTimeout(6000);
    assert.equal(
      await frame.getByLabel("Category", { exact: true }).inputValue(),
      "Unsaved category draft",
    );
    await frame
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    page.once("dialog", (dialog) => dialog.accept());
    const download = page.waitForEvent("download");
    await frame
      .getByRole("button", { name: "Export filtered CSV", exact: true })
      .click();
    const exported = await download;
    assert.match(
      await fs.readFile((await exported.path())!, "utf8"),
      /Fixture Shop/,
    );
    if (!(await invoke("finance_home")).views.length) {
      await frame
        .getByRole("button", { name: "Save month view", exact: true })
        .click();
      await page.waitForTimeout(500);
    }
    const saved = (await invoke("finance_home")).views.find(
      (v: { definition: { title: string } }) =>
        v.definition.title === "Activity",
    );
    assert(saved);
    await frame.getByRole("button", { name: "Overview", exact: true }).click();
    await frame
      .getByRole("button", { name: /^Activity/ })
      .first()
      .click();
    frame = await guest("Activity");
    await frame.getByText("Fixture Shop", { exact: true }).waitFor();
    await page.reload();
    frame = await guest("Activity");
    await frame.getByText("Fixture Shop", { exact: true }).waitFor();
    await page.goto(base + "/apps/" + instance.slug);
    frame = await guest();
    await frame.getByRole("button", { name: "Budget", exact: true }).click();
    if (!(await invoke("finance_home")).budgets.length) {
      await frame
        .getByRole("button", { name: "Create a budget", exact: true })
        .click();
      await frame.getByLabel("Monthly take-home income (USD)").fill("5000");
      await frame
        .getByRole("button", { name: "Create proposal", exact: true })
        .click();
      await frame.getByRole("dialog").waitFor({ state: "hidden" });
    }
    await frame
      .getByRole("button", { name: "Adjust plan", exact: true })
      .waitFor();
    let budget = (await invoke("finance_home")).budgets[0];
    if (budget.state === "proposal") {
      await frame
        .getByRole("button", { name: "Use this budget", exact: true })
        .click();
      await frame.getByText("Active plan", { exact: true }).waitFor();
      budget = (await invoke("finance_home")).budgets[0];
    }
    await frame
      .getByRole("button", { name: "Adjust plan", exact: true })
      .click();
    await frame.getByLabel("Dining", { exact: true }).fill("275");
    await frame
      .getByRole("button", { name: "Preview changes", exact: true })
      .click();
    await frame.getByText("Preview only", { exact: true }).waitFor();
    assert.equal(
      (await invoke("finance_home")).budgets[0].revision,
      budget.revision,
    );
    await frame
      .getByRole("button", { name: "Apply reviewed changes", exact: true })
      .click();
    await frame.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(
      (await invoke("finance_home")).budgets[0].revision,
      budget.revision + 1,
    );
    await frame
      .getByRole("button", { name: "Undo last change", exact: true })
      .click();
    await page.waitForTimeout(500);
    assert.deepEqual(
      (await invoke("finance_home")).budgets[0].plan,
      budget.plan,
    );
    await frame.getByRole("button", { name: "Overview", exact: true }).click();
    await frame
      .getByRole("button", { name: "Open Finances chat", exact: true })
      .click();
    const editor = page
      .locator("[contenteditable=true]")
      .filter({ visible: true })
      .first();
    await editor.waitFor({ timeout: 90000 });
    await editor.fill("Keep my existing message.");
    frame = await guest();
    await frame
      .getByRole("button", { name: "Talk through this month", exact: true })
      .click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("[contenteditable=true]")).some(
        (e) => e.textContent?.includes("Review my financial overview"),
      ),
    );
    assert.match(await editor.innerText(), /Keep my existing message/);
    const chat = await rpc("documentChat.list", {
      query: { entityType: "app", entityId: instance.id },
    });
    // No send is triggered by an app question. The transcript stays empty.
    assert(chat.session.id);
    assert.equal(
      (
        await rpc("sessions.eventsGet", {
          params: { id: chat.session.id },
          query: { limit: "20" },
        })
      ).filter((event: { source: string }) => event.source === "user").length,
      0,
      "App suggestion sent itself",
    );
    await page.screenshot({
      path: path.join(root, "finances-native-chat.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 850, height: 900 });
    await page.getByRole("tab", { name: "App", exact: true }).click();
    frame = await guest();
    await frame
      .getByRole("heading", { name: "Money in. Money out." })
      .waitFor();
    assert(
      await frame
        .locator("html")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    );
    await page.getByRole("tab", { name: "Chat", exact: true }).click();
    assert.match(
      await page
        .locator("[contenteditable=true]")
        .filter({ visible: true })
        .first()
        .innerText(),
      /Keep my existing message/,
    );
    // Ri mounts another page tree at the phone breakpoint. The app chat stays
    // open and the existing durable composer draft survives that remount.
    await page.setViewportSize({ width: 600, height: 900 });
    await page.getByRole("tab", { name: "Chat", exact: true }).waitFor();
    assert.match(
      await page
        .locator("[contenteditable=true]")
        .filter({ visible: true })
        .first()
        .innerText(),
      /Keep my existing message/,
    );
    await page.getByRole("tab", { name: "App", exact: true }).click();
    frame = await guest();
    await frame
      .getByRole("button", { name: "Talk through this month", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "Chat", exact: true })
      .and(page.locator('[aria-selected="true"]'))
      .waitFor();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("[contenteditable=true]")).some(
        (e) =>
          !e.closest("[inert]") &&
          e.getBoundingClientRect().width > 0 &&
          (e.textContent?.split("Review my financial overview").length ?? 0) >=
            3,
      ),
    );
    await page.screenshot({
      path: path.join(root, "finances-mobile-chat.png"),
      fullPage: true,
    });
    assert.deepEqual(pageErrors, []);
    console.log(
      "PASS: native install, setup, file picker, staged CSV, exact balances, preserved edits, download, saved view/reopen, budget preview/apply/undo, native chat draft and narrow pane switching",
    );
  } catch (error) {
    console.error(pageErrors);
    await page.screenshot({
      path: path.join(root, "finances-browser-failure.png"),
      fullPage: true,
    });
    console.error(
      await Promise.all(
        page.frames().map(async (f) => ({
          frame: f.url().split("#")[0],
          text: (await f.locator("body").innerText()).slice(0, 1800),
        })),
      ),
    );
    throw error;
  } finally {
    await browser.close();
  }
}
void main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message.replace(
          /(?:#token=|ri_live_)[^\s"']+/g,
          "[private fixture token]",
        )
      : "Fixture failed",
  );
  process.exitCode = 1;
});
