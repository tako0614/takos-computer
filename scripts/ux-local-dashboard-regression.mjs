// Optional browser regression against the documented local simulator. Run with
// TMPDIR on disk and COMPUTER_UX_URL=http://127.0.0.1:<port>. Playwright may be
// supplied with PLAYWRIGHT_MODULE; this script never uses a real account token.
import { mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const output = resolve(
  process.env.COMPUTER_UX_EVIDENCE ?? ".computer-ux-results",
);
await mkdir(output, { recursive: true, mode: 0o700 });
const result = { scope: "local simulator UI only", checks: [], creates: 0 };
let browser;
let context;
let releaseCreate;
const record = (name, pass) => result.checks.push({ name, pass });
try {
  const url = new URL(process.env.COMPUTER_UX_URL ?? "http://127.0.0.1:3000");
  if (
    !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ||
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("A loopback origin is required");
  const origin = url.origin;
  result.origin = origin;
  const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE ?? "playwright-core"
  );
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN ?? "/opt/google/chrome/chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });
  const createBarrier = new Promise((resolve) => {
    releaseCreate = resolve;
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const u = new URL(request.url());
    if (u.origin !== origin) return route.abort();
    if (u.pathname.endsWith("/mcp")) {
      const body = request.postDataJSON();
      // The nonisolated simulator's process list is outside these tests. Do not
      // fetch host process arguments, and do not qualify this panel from a stub.
      if (body.params?.name === "process_list") {
        return route.fulfill({
          json: {
            jsonrpc: "2.0",
            id: body.id,
            result: { content: [{ type: "text", text: '{"processes":[]}' }] },
          },
        });
      }
    }
    if (u.pathname.endsWith("/sandbox-create")) {
      result.creates++;
      await createBarrier;
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  // Public README fixture, not a supplied credential. Never read cookie/storage.
  await page.goto(origin + "/gui?authToken=local-host-token", {
    waitUntil: "networkidle",
  });
  const trigger = page.getByRole("button", {
    name: "+ Sandbox Session",
    exact: true,
  });
  await trigger.click();
  const modal = page.locator(".modal-content");
  await modal.waitFor({ state: "visible" });
  const fields = modal.locator("input");
  record(
    "named modal and associated labels",
    (await page
      .getByRole("dialog", { name: "Create Sandbox Session", exact: true })
      .count()) === 1 &&
      (await fields.evaluateAll(
        (xs) => xs.length === 3 && xs.every((x) => x.labels.length === 1),
      )),
  );
  record(
    "initial focus inside",
    await fields.first().evaluate((x) => x === document.activeElement),
  );
  await fields.first().focus();
  await page.keyboard.press("Shift+Tab");
  const create = modal.getByRole("button", { name: "Create", exact: true });
  record(
    "backward Tab stays inside",
    await create.evaluate((x) => x === document.activeElement),
  );
  await page.keyboard.press("Tab");
  record(
    "forward Tab wraps",
    await fields.first().evaluate((x) => x === document.activeElement),
  );
  await page.keyboard.press("Escape");
  const escapeClosed = (await modal.count()) === 0;
  record(
    "Escape closes and restores trigger",
    escapeClosed &&
      (await trigger.evaluate((x) => x === document.activeElement)),
  );
  if (!escapeClosed)
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  record("keyboard dismissal never creates", result.creates === 0);
  if (!process.argv.includes("--dialog-only")) {
    if (!process.env.COMPUTER_UX_WORKSPACE_ROOT) {
      throw new Error("The local simulator workspace root is required");
    }
    const root = resolve(process.env.COMPUTER_UX_WORKSPACE_ROOT);
    const beforeFolders = new Set(
      await readdir(root).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      }),
    );
    await trigger.click();
    const id = "ux-local-" + crypto.randomUUID();
    await page.getByLabel("Session ID", { exact: true }).fill(id);
    await page.getByLabel("Space ID", { exact: true }).fill("ux-local-space");
    await page.getByLabel("User ID", { exact: true }).fill("ux-local-user");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page
      .getByRole("button", { name: "Creating...", exact: true })
      .waitFor();
    await page.getByLabel("Session ID", { exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    const pendingVisible = (await modal.count()) === 1;
    record("pending Escape keeps submission visible", pendingVisible);
    record(
      "pending Cancel is disabled",
      pendingVisible &&
        (await modal
          .getByRole("button", { name: "Cancel", exact: true })
          .isDisabled()),
    );
    record(
      "pending inputs cannot change the submitted draft",
      pendingVisible &&
        (await fields.evaluateAll((xs) => xs.every((x) => x.readOnly))),
    );
    releaseCreate();
    const row = page.getByRole("row").filter({ hasText: id });
    await row.getByRole("link", { name: "Open", exact: true }).waitFor();
    const added = (await readdir(root)).filter(
      (name) => !beforeFolders.has(name),
    );
    const expectedWorkspace =
      added.length === 1 ? await realpath(join(root, added[0])) : undefined;
    record(
      "one new local workspace is unambiguous",
      expectedWorkspace !== undefined,
    );
    const initialListReply = page.waitForResponse(
      (r) =>
        r.url().endsWith("/mcp") &&
        r.request().postDataJSON().params?.name === "file_list" &&
        r.request().postDataJSON().params?.arguments?.path === ".",
    );
    await row.getByRole("link", { name: "Open", exact: true }).click();
    const initialBody = await (await initialListReply).json();
    const listing = JSON.parse(initialBody.result.content[0].text);
    await page.getByText("Empty directory", { exact: true }).waitFor();
    record("one pending create produces one session", result.creates === 1);
    const cwd = page.locator("input.input-mono");
    record(
      "initial relative workspace lists true empty",
      (await cwd.inputValue()) === "." &&
        (await page.getByRole("alert").count()) === 0 &&
        initialBody.result.isError !== true &&
        Array.isArray(listing.entries) &&
        listing.entries.length === 0,
    );
    await cwd.fill("../outside-workspace");
    await page
      .getByRole("alert")
      .filter({ hasText: "outside workspace" })
      .waitFor();
    record(
      "jail failure is an error rather than empty",
      (await page.getByText("Empty directory", { exact: true }).count()) === 0,
    );
    // Refresh is explicit; it does not reinterpret the refusal as an empty read.
    const refreshReply = page.waitForResponse(
      (r) =>
        r.url().endsWith("/mcp") &&
        r.request().postDataJSON().params?.name === "file_list" &&
        r.request().postDataJSON().params?.arguments?.path ===
          "../outside-workspace",
    );
    await cwd
      .locator("..")
      .getByRole("button", { name: "Refresh", exact: true })
      .click();
    const refreshBody = await (await refreshReply).json();
    record(
      "explicit refresh retains the refused path",
      refreshBody.result?.isError === true,
    );
    await page
      .getByRole("alert")
      .filter({ hasText: "outside workspace" })
      .waitFor();
    await cwd.fill(".");
    await page.getByText("Empty directory", { exact: true }).waitFor();
    record(
      "returning to workspace recovers",
      (await page.getByRole("alert").count()) === 0,
    );
    const command = page.getByPlaceholder("command...", { exact: true });
    await command.fill("pwd");
    const pwdReply = page.waitForResponse(
      (r) =>
        r.url().endsWith("/mcp") &&
        r.request().postDataJSON().params?.name === "shell_exec",
    );
    await command.press("Enter");
    const pwdBody = await (await pwdReply).json();
    const pwd = JSON.parse(pwdBody.result.content[0].text);
    record(
      "relative cwd runs in actual jail",
      pwd.exit_code === 0 && pwd.stdout.trim() === expectedWorkspace,
    );
    await command.fill("printf ux-expected-nonzero >&2; exit 7");
    await command.press("Enter");
    await page.getByText("exit 7", { exact: false }).waitFor();
    record(
      "ordinary nonzero command remains visible",
      (await page.locator("body").innerText()).includes("ux-expected-nonzero"),
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Empty directory", { exact: true }).waitFor();
    record(
      "same-process original reopens on reload",
      result.creates === 1 && (await cwd.inputValue()) === ".",
    );
  }
  record("no uncaught browser errors", pageErrors.length === 0);
  result.status = result.checks.every((x) => x.pass) ? "PASS" : "RED";
} catch (error) {
  result.status = "HARNESS_ERROR";
  // Do not echo a rejected raw URL input or dependency loader diagnostics.
  result.error = error instanceof Error ? error.name : "UnknownError";
} finally {
  releaseCreate?.();
  try {
    await context?.close();
  } catch {
    result.status = "HARNESS_ERROR";
    result.cleanup = "context close failed";
  }
  try {
    await browser?.close();
  } catch {
    result.status = "HARNESS_ERROR";
    result.cleanup = "browser close failed";
  }
  await writeFile(
    resolve(output, "RESULT.json"),
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === "PASS" ? 0 : 1;
