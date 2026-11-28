import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import { tmpdir } from "node:os";

const repo = resolve(process.env.COMPUTER_WAVE5_REPO ?? resolve(import.meta.dirname, ".."));
const out = resolve(process.env.COMPUTER_WAVE5_EVIDENCE ?? await mkdtemp(join(tmpdir(), "computer-wave5-evidence-")));
await mkdir(out, { recursive: true, mode: 448 });
const harnessSha256 = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
const html = await readFile(join(repo, "packages/computer-hosts/src/gui/app.html"));

const sessions = [
  { sessionId: "alpha-active", spaceId: "space-workspace-01", userId: "alice", status: "active", createdAt: "2026-01-01T00:00:00.000Z" },
  { sessionId: "beta-starting", spaceId: "space-workspace-02", userId: "bob", status: "starting", createdAt: "2026-01-01T00:01:00.000Z" },
  { sessionId: "gamma-stopped", spaceId: "space-workspace-03", userId: "charlie", status: "stopped", createdAt: "2026-01-01T00:02:00.000Z" },
];

let alphaStatus = "active";
let holdNextStatus = false;
let releaseStatus = null;
let statusCalls = 0;
let processes = [
  { user: "root", pid: 1, cpu: "0.0", mem: "0.2", command: "/sbin/init" },
  { user: "sandbox", pid: 42, cpu: "12.4", mem: "3.8", command: "bun run server.ts --port 8080" },
  { user: "sandbox", pid: 108, cpu: "0.3", mem: "1.1", command: "python3 -m http.server 9000" },
];

const requests = [], actions = [], assertions = [], errors = [], intercepted = [], interceptorErrors = [], snapshots = {};
const pending = new Map(), tasks = new Set(), dialogs = [];
let nextId = 1, ws, chrome, chromeExit, profile, fixturePort, debugPort, fatal = null;
let chromeStderr = "", creates = 0, cleanup = {}, browserVersion;

const send = (res, status, body) => {
  if (!res.headersSent) res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && (u.pathname === "/gui" || u.pathname === "/gui/" || u.pathname.startsWith("/gui/sandbox/"))) {
      requests.push({ kind: "dashboard", path: u.pathname });
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      return res.end(html);
    }
    if (req.method === "GET" && ["/gui/manifest.webmanifest", "/gui/icons/icon-192.png", "/gui/icons/icon-512.png", "/gui/icons/icon-maskable-512.png", "/gui/icons/apple-touch-icon.png"].includes(u.pathname)) {
      const data = await readFile(join(repo, "packages/dashboard/public", u.pathname.slice(5)));
      res.writeHead(200, { "content-type": u.pathname.endsWith(".png") ? "image/png" : "application/manifest+json" });
      return res.end(data);
    }
    if (req.method === "GET" && u.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "GET" && u.pathname === "/gui/api/sandbox-sessions") {
      requests.push({ kind: "session-list" });
      return send(res, 200, { sessions });
    }
    const sessMatch = u.pathname.match(/^\/gui\/api\/sandbox-session\/([^/]+)$/);
    if (sessMatch && req.method === "GET") {
      const id = decodeURIComponent(sessMatch[1]);
      statusCalls++;
      requests.push({ kind: "session-status", id, status: alphaStatus });
      if (holdNextStatus) {
        holdNextStatus = false;
        await new Promise((r) => { releaseStatus = r; });
      }
      const found = sessions.find((s) => s.sessionId === id);
      if (!found) return send(res, 404, { error: "not found" });
      return send(res, 200, id === "alpha-active" ? { ...found, status: alphaStatus } : found);
    }
    const mcpMatch = u.pathname.match(/^\/gui\/api\/sandbox-session\/([^/]+)\/mcp$/);
    if (mcpMatch && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const call = JSON.parse(raw);
      const tool = call.params?.name;
      const args = call.params?.arguments ?? {};
      requests.push({ kind: "mcp", tool, args });
      let payload;
      if (tool === "process_list") {
        payload = { processes };
      } else if (tool === "process_kill") {
        const pid = Number(args.pid);
        processes = processes.filter((p) => p.pid !== pid);
        payload = { killed: true, pid, signal: args.signal ?? "SIGTERM" };
      } else if (tool === "file_list") {
        payload = {
          entries: [
            { name: "README.md", type: "file", size: 64, modified: "2026-01-01T00:00:00.000Z" },
          ],
        };
      } else if (tool === "file_read") {
        payload = { content: "# Wave 5\nHello world\n", size: 21, truncated: false };
      } else if (tool === "shell_exec") {
        const cmd = String(args.command ?? "");
        if (cmd === "wide-table") {
          payload = {
            stdout: [
              "COL1   COL2     COL3    VALUE",
              "row-1  alpha    match   " + "segment-".repeat(24) + "tail",
              "row-2  beta     MATCH   second-match-line",
              "row-3  gamma    other   final-match-here",
            ].join("\n") + "\n",
            stderr: "",
            exit_code: 0,
            timed_out: false,
          };
        } else {
          payload = { stdout: `ok: ${cmd}\n`, stderr: "", exit_code: 0, timed_out: false };
        }
      } else {
        requests.push({ kind: "forbidden-tool", tool });
        return send(res, 403, { error: "Forbidden tool in fixture" });
      }
      return send(res, 200, {
        jsonrpc: "2.0",
        id: call.id,
        result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
      });
    }
    if (req.method === "POST" && u.pathname === "/gui/api/sandbox-create") creates++;
    requests.push({ kind: "forbidden-route", method: req.method, path: u.pathname });
    return send(res, 403, { error: "Synthetic fixture only" });
  } catch (e) {
    errors.push("fixture: " + e.message);
    send(res, 500, { error: e.message });
  }
});

const listen = (s) => new Promise((yes, no) => {
  s.once("error", no);
  s.listen(0, "127.0.0.1", () => yes(s.address().port));
});
const reserve = () => new Promise((yes, no) => {
  const s = net.createServer();
  s.once("error", no);
  s.listen(0, "127.0.0.1", () => {
    const port = s.address().port;
    s.close((e) => e ? no(e) : yes(port));
  });
});
const bounded = (p, label, ms = 1e4) => Promise.race([
  p,
  delay(ms).then(() => { throw Error("timeout: " + label); }),
]);
function check(name, passed, detail) {
  assertions.push({ name, passed: Boolean(passed), detail });
}
function cdp(method, params = {}, ms = 1e4) {
  const id = nextId++;
  return bounded(new Promise((yes, no) => {
    pending.set(id, { yes, no, method });
    ws.send(JSON.stringify({ id, method, params }));
  }), "CDP " + method, ms);
}
async function ev(expression) {
  const r = await cdp("Runtime.evaluate", { expression: `(${expression})`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function wait(predicate, label, ms = 8e3) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ev(`Boolean(${predicate})`)) return;
    await delay(30);
  }
  throw Error("wait failed: " + label);
}
async function click(selectorExpr, label) {
  const pt = await ev(`(()=>{const el=${selectorExpr};if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null;})()`);
  if (!pt) throw Error("missing clickable element: " + label);
  actions.push({ action: label, kind: "pointer", at: Date.now() });
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
}
async function key(k, code = k, modifiers = 0) {
  actions.push({ action: "key " + k, kind: "keyboard", at: Date.now() });
  const keyCodeMap = { Tab: 9, Enter: 13, Escape: 27, f: 70 };
  const keyCode = keyCodeMap[k] ?? 0;
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, modifiers, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, modifiers });
}
async function typeText(text) {
  actions.push({ action: "type " + text, kind: "keyboard", at: Date.now() });
  await cdp("Input.insertText", { text });
}
async function paint() {
  await ev("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
}
async function navigate(path) {
  await cdp("Page.navigate", { url: `http://127.0.0.1:${fixturePort}${path}` });
  await wait(`document.readyState==='complete'&&!!document.querySelector('#app')?.children.length`, "app load");
}

try {
  fixturePort = await listen(server);
  debugPort = await reserve();
  profile = await mkdtemp(join(tmpdir(), "computer-wave5-chrome-"));
  chrome = spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--password-store=basic", "--disable-extensions", "--disable-background-networking",
    "--disable-component-update", "--disable-sync", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
    `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  chrome.stderr.on("data", (chunk) => { chromeStderr = (chromeStderr + chunk.toString()).slice(0, 65536); });
  chromeExit = new Promise((resolve2) => {
    chrome.once("exit", (code, signal) => resolve2({ code, signal }));
    chrome.once("error", (e) => resolve2({ error: e.message }));
  });
  let version;
  for (let n = 0; n < 80; n++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(500) })).json();
      break;
    } catch {
      await delay(60);
    }
  }
  if (!version) throw Error("Chrome startup");
  browserVersion = version.Browser;
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(1e3) })).json();
  const target = targets.find((x) => x.type === "page" && x.url === "about:blank");
  if (!target) throw Error("owned initial blank target missing");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await bounded(new Promise((yes, no) => {
    ws.addEventListener("open", yes, { once: true });
    ws.addEventListener("error", no, { once: true });
  }), "CDP connect");
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.no(Error(m.error.message)) : p.yes(m.result);
    } else if (m.method === "Runtime.exceptionThrown") {
      errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    } else if (m.method === "Page.javascriptDialogOpening") {
      dialogs.push({ type: m.params.type, message: m.params.message });
      errors.push("unexpected native dialog " + m.params.type);
      const task = cdp("Page.handleJavaScriptDialog", { accept: false }).catch((e) => interceptorErrors.push(e.message)).finally(() => tasks.delete(task));
      tasks.add(task);
    } else if (m.method === "Fetch.requestPaused") {
      const u = new URL(m.params.request.url);
      const allowed = ["127.0.0.1", "localhost"].includes(u.hostname) && Number(u.port || 80) === fixturePort;
      intercepted.push({ url: m.params.request.url, method: m.params.request.method, allowed });
      const task = cdp(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed ? { requestId: m.params.requestId } : { requestId: m.params.requestId, errorReason: "BlockedByClient" })
        .catch((e) => interceptorErrors.push(e.message)).finally(() => tasks.delete(task));
      tasks.add(task);
    }
  });

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await navigate("/gui");
  await wait(`document.querySelectorAll('tbody tr td.session-id-cell').length===3`, "initial 3 sessions");

  // 1. Desktop session table does not wrap short usernames mid-word (e.g. charlie)
  const charlieWrap = await ev(`(()=>{
    const td = [...document.querySelectorAll('tbody td')].find(el => el.textContent.trim() === 'charlie');
    if (!td) return null;
    const r = document.createRange();
    r.selectNodeContents(td.firstChild);
    return { rects: r.getClientRects().length, width: Math.round(td.getBoundingClientRect().width) };
  })()`);
  check("desktop session table renders 'charlie' on one line without mid-word wrapping", charlieWrap && charlieWrap.rects === 1, charlieWrap);

  // 2. Dashboard session search IME composition guard
  const dashIme = await ev(`(()=>{
    const input = document.querySelector('input.session-search-input');
    input.focus();
    input.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    input.value = 'ａｌｐｈａ';
    input.dispatchEvent(new InputEvent('input', { data: 'ａｌｐｈａ', isComposing: true, bubbles: true }));
    const duringRows = document.querySelectorAll('tbody tr td.session-id-cell').length;
    const duringVal = input.value;
    input.value = 'alpha';
    input.dispatchEvent(new CompositionEvent('compositionend', { data: 'alpha', bubbles: true }));
    return { duringRows, duringVal };
  })()`);
  await paint();
  const afterDashIme = await ev(`document.querySelectorAll('tbody tr td.session-id-cell').length`);
  check(
    "Dashboard session search guards CJK IME composition and commits filter on compositionend",
    dashIme.duringRows === 3 && dashIme.duringVal === "ａｌｐｈａ" && afterDashIme === 1,
    { dashIme, afterDashIme },
  );
  await key("Escape");
  await paint();

  // 3. CreateModal client-side validation a11y (noValidate empty submit + scoped aria-invalid/aria-describedby)
  await click(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='+ Sandbox Session')`, "open CreateModal");
  await wait(`document.querySelector('[role="dialog"]')`, "CreateModal open");
  await click(`document.querySelector('[role="dialog"] button[type="submit"]')`, "submit empty CreateModal");
  await paint();
  const emptyCreateValidation = await ev(`(()=>{
    const s = document.querySelector('input[name="sessionId"]');
    const sp = document.querySelector('input[name="spaceId"]');
    const u = document.querySelector('input[name="userId"]');
    const alert = document.querySelector('[role="dialog"] [role="alert"]');
    return {
      alertId: alert?.id ?? '',
      alertText: alert?.textContent?.trim() ?? '',
      invalids: [s, sp, u].map((el) => el?.getAttribute('aria-invalid')),
      describedBys: [s, sp, u].map((el) => el?.getAttribute('aria-describedby')),
      focusedSessionId: document.activeElement === s,
    };
  })()`);
  check(
    "CreateModal empty submit runs localized validation (noValidate), marks all empty fields invalid, and focuses sessionId",
    Boolean(emptyCreateValidation.alertId) &&
      emptyCreateValidation.alertText.includes("required") &&
      emptyCreateValidation.invalids.every((v) => v === "true") &&
      emptyCreateValidation.describedBys.every((v) => v === emptyCreateValidation.alertId) &&
      emptyCreateValidation.focusedSessionId,
    emptyCreateValidation,
  );
  await ev(`(()=>{
    document.querySelector('input[name="sessionId"]').value = 'pmcp-reserved';
    document.querySelector('input[name="spaceId"]').value = 'sp-1';
    document.querySelector('input[name="userId"]').value = 'u-1';
  })()`);
  await click(`document.querySelector('[role="dialog"] button[type="submit"]')`, "submit invalid reserved sessionId");
  await paint();
  const createValidation = await ev(`(()=>{
    const input = document.querySelector('input[name="sessionId"]');
    const space = document.querySelector('input[name="spaceId"]');
    const user = document.querySelector('input[name="userId"]');
    const alert = document.querySelector('[role="dialog"] [role="alert"]');
    return {
      invalid: input?.getAttribute('aria-invalid'),
      describedBy: input?.getAttribute('aria-describedby'),
      spaceInvalid: space?.getAttribute('aria-invalid'),
      spaceDescribedBy: space?.getAttribute('aria-describedby'),
      userInvalid: user?.getAttribute('aria-invalid'),
      userDescribedBy: user?.getAttribute('aria-describedby'),
      alertId: alert?.id,
      focusedSessionId: document.activeElement === input,
    };
  })()`);
  check(
    "CreateModal scopes aria-invalid and aria-describedby only to invalid sessionId and focuses it",
    createValidation.invalid === "true" &&
      Boolean(createValidation.alertId) &&
      createValidation.describedBy === createValidation.alertId &&
      createValidation.spaceInvalid === null &&
      createValidation.spaceDescribedBy === null &&
      createValidation.userInvalid === null &&
      createValidation.userDescribedBy === null &&
      createValidation.focusedSessionId,
    createValidation,
  );
  await key("Escape");
  await wait(`!document.querySelector('[role="dialog"]')`, "CreateModal closed");

  // 4. Open alpha-active Viewer
  await click(`document.querySelector('tbody a[href$="/sandbox/alpha-active"]')`, "open alpha-active viewer");
  await wait(`document.querySelector('.viewer-header .badge')?.textContent.trim()==='active'`, "viewer status active");

  // 5. Viewer deduplicated SR announcements + flicker-free background poll + pause/resume auto-refresh
  const viewerSrInit = await ev(`(()=>{
    const badge = document.querySelector('.viewer-header .badge');
    const sr = document.querySelector('.viewer-controls .sr-only[role="status"][aria-live="polite"]');
    const footerStatus = document.querySelector('.footer-note-info [role="status"][aria-live="polite"]');
    const toggle = document.querySelector('.footer-refresh-toggle');
    window.__srMutations = 0;
    const obs = new MutationObserver(() => { window.__srMutations++; });
    if (sr) obs.observe(sr, { characterData: true, childList: true, subtree: true });
    return {
      badgeHasRoleStatus: badge?.hasAttribute('role'),
      srText: sr?.textContent.trim(),
      footerStatus: footerStatus?.textContent.trim(),
      toggleLabel: toggle?.textContent.trim(),
      toggleHasAriaPressed: toggle?.hasAttribute('aria-pressed'),
    };
  })()`);
  check(
    "Viewer separates visual badge from deduplicated SR live region and renders footer auto-refresh control",
    viewerSrInit.badgeHasRoleStatus === false &&
      viewerSrInit.srText === "Session status: active" &&
      viewerSrInit.footerStatus === "Auto-refresh: every 10s" &&
      viewerSrInit.toggleLabel === "Pause auto-refresh" &&
      viewerSrInit.toggleHasAriaPressed === false,
    viewerSrInit,
  );

  // Hold the real 10s background poll and verify badge does NOT flicker to loading!
  holdNextStatus = true;
  const pollWaitEnd = Date.now() + 12500;
  while (!releaseStatus && Date.now() < pollWaitEnd) await delay(40);
  if (!releaseStatus) throw Error("expected real 10s viewer background poll did not fire");
  await paint();
  const duringBgPoll = await ev(`({
    badgeText: document.querySelector('.viewer-header .badge')?.textContent.trim(),
    srMutations: window.__srMutations,
  })`);
  check(
    "held background status poll keeps settled active badge without loading flicker or SR spam",
    duringBgPoll.badgeText === "active" && duringBgPoll.srMutations === 0,
    duringBgPoll,
  );
  releaseStatus();
  releaseStatus = null;
  await delay(150);
  const afterUnchangedPoll = await ev(`window.__srMutations`);
  check("unchanged background status poll produces zero SR live-region mutations", afterUnchangedPoll === 0, afterUnchangedPoll);

  // Pause auto-refresh on Viewer
  await click(`document.querySelector('.footer-refresh-toggle')`, "pause viewer auto-refresh");
  await paint();
  const pausedViewer = await ev(`({
    label: document.querySelector('.footer-refresh-toggle')?.textContent.trim(),
    status: document.querySelector('.footer-note-info [role="status"][aria-live="polite"]')?.textContent.trim(),
  })`);
  check(
    "pausing Viewer auto-refresh updates footer toggle and polite status text",
    pausedViewer.label === "Resume auto-refresh" && pausedViewer.status === "Auto-refresh: paused",
    pausedViewer,
  );

  // Manual Refresh status when backend status changes to stopped -> announces ONCE
  alphaStatus = "stopped";
  await click(`[...document.querySelectorAll('.viewer-controls button')].find(b=>b.textContent.trim()==='Refresh status')`, "manual refresh status");
  await wait(`document.querySelector('.viewer-header .badge')?.textContent.trim()==='stopped'`, "status changed to stopped");
  const afterStatusChange = await ev(`({
    srText: document.querySelector('.viewer-controls .sr-only[role="status"][aria-live="polite"]')?.textContent.trim(),
    srMutations: window.__srMutations,
  })`);
  check(
    "status transition announces new settled status in deduplicated SR live region",
    afterStatusChange.srText === "Session status: stopped" && afterStatusChange.srMutations >= 1,
    afterStatusChange,
  );

  // Manual Refresh status when status is unchanged sets aria-busy while held and re-confirms in SR live region
  const mutationsBeforeManualSame = await ev(`window.__srMutations`);
  holdNextStatus = true;
  await click(`[...document.querySelectorAll('.viewer-controls button')].find(b=>b.textContent.trim()==='Refresh status')`, "manual refresh status while unchanged");
  const manualHeldEnd = Date.now() + 3000;
  while (!releaseStatus && Date.now() < manualHeldEnd) await delay(20);
  if (!releaseStatus) throw Error("held manual status refresh missing");
  await paint();
  const manualBusy = await ev(`[...document.querySelectorAll('.viewer-controls button')].find(b=>b.textContent.trim()==='Refresh status')?.getAttribute('aria-busy')`);
  releaseStatus();
  releaseStatus = null;
  await wait(`document.querySelector('.viewer-header .badge')?.textContent.trim()==='stopped'`, "manual unchanged refresh settled");
  await paint();
  const afterManualSame = await ev(`({
    busyAfter: [...document.querySelectorAll('.viewer-controls button')].find(b=>b.textContent.trim()==='Refresh status')?.getAttribute('aria-busy'),
    srText: document.querySelector('.viewer-controls .sr-only[role="status"][aria-live="polite"]')?.textContent.trim(),
    srMutations: window.__srMutations,
  })`);
  check(
    "manual Refresh status sets aria-busy in flight and re-confirms unchanged status for screen readers",
    manualBusy === "true" &&
      afterManualSame.busyAfter === "false" &&
      afterManualSame.srText === "Session status: stopped" &&
      afterManualSame.srMutations > mutationsBeforeManualSame,
    { manualBusy, mutationsBeforeManualSame, afterManualSame },
  );

  // 6. Shell line-wrap toggle, DOM node stability, light-theme focus ring, and inline output search
  const findControlsClosed = await ev(`[...document.querySelectorAll('.shell-header-actions button')].find(b=>b.textContent.trim()==='Find')?.hasAttribute('aria-controls')`);
  check("Find button omits dangling aria-controls while search bar is closed", findControlsClosed === false, findControlsClosed);

  await click(`document.querySelector('.shell-input')`, "focus shell command input");
  await typeText("wide-table");
  await key("Enter");
  await wait(`document.querySelector('.shell-output')?.textContent.includes('final-match-here')`, "wide-table output rendered");

  // Observe Shell output DOM stability across command append, Find open (empty query), and Find search
  await ev(`(()=>{
    const out = document.querySelector('.shell-output');
    window.__firstCmdSpan = out.querySelector('.shell-line-cmd');
    window.__shellMutations = { added: 0, removed: 0 };
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        window.__shellMutations.added += r.addedNodes.length;
        window.__shellMutations.removed += r.removedNodes.length;
      }
    });
    obs.observe(out, { childList: true });
  })()`);
  await typeText("second-cmd");
  await key("Enter");
  await wait(`document.querySelector('.shell-output')?.textContent.includes('ok: second-cmd')`, "second-cmd output rendered");
  const afterSecondAppend = await ev(`({
    firstConnected: window.__firstCmdSpan?.isConnected === true,
    removed: window.__shellMutations.removed,
    added: window.__shellMutations.added,
  })`);
  check(
    "appending new shell output keeps existing line spans mounted without removing prior nodes",
    afterSecondAppend.firstConnected && afterSecondAppend.removed === 0 && afterSecondAppend.added === 2,
    afterSecondAppend,
  );

  // Light-mode focus ring inside dark .shell-box stays high-contrast #60a5fa
  await click(`[...document.querySelectorAll('.theme-switcher button')].find(b=>b.textContent.trim()==='Light')`, "switch to Light theme");
  await paint();
  const shellLightFocusRing = await ev(`getComputedStyle(document.querySelector('.shell-box')).getPropertyValue('--tc-focus-ring').trim().toLowerCase()`);
  check("dark .shell-box keeps high-contrast #60a5fa focus ring in Light theme", shellLightFocusRing === "#60a5fa", shellLightFocusRing);
  await click(`[...document.querySelectorAll('.theme-switcher button')].find(b=>b.textContent.trim()==='Dark')`, "restore Dark theme");
  await paint();

  // Toggle Wrap off -> no-wrap mode scrolls horizontally inside shell without page overflow
  const wrapBefore = await ev(`({
    pressed: [...document.querySelectorAll('.shell-header-actions button')].find(b=>b.textContent.trim()==='Wrap')?.getAttribute('aria-pressed'),
    hasNoWrap: document.querySelector('.shell-output')?.classList.contains('shell-output-nowrap'),
  })`);
  await click(`[...document.querySelectorAll('.shell-header-actions button')].find(b=>b.textContent.trim()==='Wrap')`, "toggle line wrap off");
  await paint();
  const wrapAfter = await ev(`({
    pressed: [...document.querySelectorAll('.shell-header-actions button')].find(b=>b.textContent.trim()==='Wrap')?.getAttribute('aria-pressed'),
    hasNoWrap: document.querySelector('.shell-output')?.classList.contains('shell-output-nowrap'),
    shellOverflowX: (document.querySelector('.shell-output')?.scrollWidth ?? 0) > (document.querySelector('.shell-output')?.clientWidth ?? 0),
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  })`);
  check(
    "Shell Wrap toggle switches aria-pressed and enables horizontal scroll for wide output without page overflow",
    wrapBefore.pressed === "true" &&
      wrapBefore.hasNoWrap === false &&
      wrapAfter.pressed === "false" &&
      wrapAfter.hasNoWrap === true &&
      wrapAfter.shellOverflowX === true &&
      wrapAfter.pageOverflow === false,
    { wrapBefore, wrapAfter },
  );

  // Open Shell output search via Find button, verify 0 output DOM churn on open, valid aria-controls, IME safety, aria-live="off", match count, and Escape close
  await ev(`window.__shellMutations = { added: 0, removed: 0 }`);
  await click(`[...document.querySelectorAll('.shell-header-actions button')].find(b=>b.textContent.trim()==='Find')`, "open shell find bar");
  await wait(`document.querySelector('.shell-search-input')`, "shell search bar visible");
  const onFindOpen = await ev(`(()=>{
    const btn = [...document.querySelectorAll('.shell-header-actions button')].find(b=>b.textContent.trim()==='Find');
    const ctrl = btn?.getAttribute('aria-controls');
    return {
      ctrlExists: Boolean(ctrl && document.getElementById(ctrl)),
      added: window.__shellMutations.added,
      removed: window.__shellMutations.removed,
      firstConnected: window.__firstCmdSpan?.isConnected === true,
    };
  })()`);
  check(
    "opening Find binds valid aria-controls and causes zero shell-output DOM mutations",
    onFindOpen.ctrlExists && onFindOpen.added === 0 && onFindOpen.removed === 0 && onFindOpen.firstConnected,
    onFindOpen,
  );

  const shellSearchIme = await ev(`(()=>{
    const input = document.querySelector('.shell-search-input');
    input.focus();
    input.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    input.value = 'ｍａｔｃｈ';
    input.dispatchEvent(new InputEvent('input', { data: 'ｍａｔｃｈ', isComposing: true, bubbles: true }));
    const duringMarks = document.querySelectorAll('.shell-output mark.shell-match').length;
    input.value = 'match';
    input.dispatchEvent(new CompositionEvent('compositionend', { data: 'match', bubbles: true }));
    return { duringMarks };
  })()`);
  await paint();
  const afterShellIme = await ev(`({
    marks: document.querySelectorAll('.shell-output mark.shell-match').length,
    activeIdx: document.querySelector('.shell-output mark.shell-match-active')?.getAttribute('data-match-index'),
    countText: document.querySelector('.shell-search-count')?.textContent.trim(),
    ariaLiveDuringSearch: document.querySelector('.shell-output')?.getAttribute('aria-live'),
    firstConnected: window.__firstCmdSpan?.isConnected === true,
    outputChildChurn: window.__shellMutations.added + window.__shellMutations.removed,
  })`);
  check(
    "Shell output search guards IME composition, silences shell-output aria-live, preserves spans, and highlights matches",
    shellSearchIme.duringMarks === 0 &&
      afterShellIme.marks === 4 &&
      afterShellIme.activeIdx === "0" &&
      afterShellIme.countText === "1 / 4" &&
      afterShellIme.ariaLiveDuringSearch === "off" &&
      afterShellIme.firstConnected === true &&
      afterShellIme.outputChildChurn === 0,
    { shellSearchIme, afterShellIme },
  );

  await key("Enter");
  await paint();
  const afterNextMatch = await ev(`({
    activeIdx: document.querySelector('.shell-output mark.shell-match-active')?.getAttribute('data-match-index'),
    countText: document.querySelector('.shell-search-count')?.textContent.trim(),
  })`);
  await key("Enter", "Enter", 8);
  await paint();
  const afterPrevMatch = await ev(`({
    activeIdx: document.querySelector('.shell-output mark.shell-match-active')?.getAttribute('data-match-index'),
    countText: document.querySelector('.shell-search-count')?.textContent.trim(),
  })`);
  check(
    "Enter and Shift+Enter cycle active Shell search matches",
    afterNextMatch.activeIdx === "1" &&
      afterNextMatch.countText === "2 / 4" &&
      afterPrevMatch.activeIdx === "0" &&
      afterPrevMatch.countText === "1 / 4",
    { afterNextMatch, afterPrevMatch },
  );

  // Escape once clears query; Escape twice closes search bar and restores focus to Find button
  await key("Escape");
  await paint();
  const afterEsc1 = await ev(`({
    open: Boolean(document.querySelector('.shell-search-input')),
    val: document.querySelector('.shell-search-input')?.value,
    marks: document.querySelectorAll('.shell-output mark.shell-match').length,
  })`);
  await key("Escape");
  await paint();
  const afterEsc2 = await ev(`({
    open: Boolean(document.querySelector('.shell-search-input')),
    focusedFind: document.activeElement?.textContent?.trim() === 'Find',
  })`);
  check(
    "Escape clears shell search query first, then closes search bar and restores focus to Find button",
    afterEsc1.open === true &&
      afterEsc1.val === "" &&
      afterEsc1.marks === 0 &&
      afterEsc2.open === false &&
      afterEsc2.focusedFind === true,
    { afterEsc1, afterEsc2 },
  );

  // Ctrl+F inside Shell opens search bar; Escape from a nav button closes bar immediately
  await click(`document.querySelector('.shell-input')`, "focus shell input for Ctrl+F");
  await key("f", "KeyF", 2);
  await wait(`document.querySelector('.shell-search-input')`, "Ctrl+F opens shell search");
  await ev(`document.querySelector('.shell-search-nav-btn')?.focus()`);
  await key("Escape");
  await paint();
  const afterNavEsc = await ev(`({
    open: Boolean(document.querySelector('.shell-search-input')),
    focusedFind: document.activeElement?.textContent?.trim() === 'Find',
    ariaLiveRestored: document.querySelector('.shell-output')?.getAttribute('aria-live') === 'polite',
    findHasControls: [...document.querySelectorAll('.shell-header-actions button')].find(b=>b.textContent.trim()==='Find')?.hasAttribute('aria-controls'),
  })`);
  check(
    "Ctrl+F opens shell search and Escape from nav buttons closes it cleanly, restoring aria-live and omitting aria-controls",
    afterNavEsc.open === false &&
      afterNavEsc.focusedFind === true &&
      afterNavEsc.ariaLiveRestored === true &&
      afterNavEsc.findHasControls === false,
    afterNavEsc,
  );

  // CreateFileDialog client-side validation a11y (noValidate empty submit + invalid path)
  await click(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='+ New file')`, "open CreateFileDialog");
  await wait(`document.querySelector('[role="dialog"] input[name="fileName"]')`, "CreateFileDialog open");
  await click(`document.querySelector('[role="dialog"] button[type="submit"]')`, "submit empty CreateFileDialog");
  await paint();
  const emptyFileValidation = await ev(`(()=>{
    const input = document.querySelector('[role="dialog"] input[name="fileName"]');
    const alert = document.querySelector('[role="dialog"] [role="alert"]');
    return {
      invalid: input?.getAttribute('aria-invalid'),
      describedBy: input?.getAttribute('aria-describedby') ?? '',
      alertId: alert?.id ?? '',
      alertText: alert?.textContent?.trim() ?? '',
      focusedInput: document.activeElement === input,
    };
  })()`);
  check(
    "CreateFileDialog empty submit runs localized validation (noValidate) and focuses input",
    emptyFileValidation.invalid === "true" &&
      Boolean(emptyFileValidation.alertId) &&
      emptyFileValidation.describedBy.includes(emptyFileValidation.alertId) &&
      emptyFileValidation.alertText.includes("Enter a file name") &&
      emptyFileValidation.focusedInput,
    emptyFileValidation,
  );
  await ev(`document.querySelector('[role="dialog"] input[name="fileName"]').value = '../escape.txt'`);
  await click(`document.querySelector('[role="dialog"] button[type="submit"]')`, "submit invalid filename");
  await paint();
  const newFileValidation = await ev(`(()=>{
    const input = document.querySelector('[role="dialog"] input[name="fileName"]');
    const alert = document.querySelector('[role="dialog"] [role="alert"]');
    return {
      invalid: input?.getAttribute('aria-invalid'),
      describedBy: input?.getAttribute('aria-describedby') ?? '',
      alertId: alert?.id ?? '',
      focusedInput: document.activeElement === input,
    };
  })()`);
  check(
    "CreateFileDialog marks invalid filename with aria-invalid, aria-describedby, and keeps focus on input",
    newFileValidation.invalid === "true" &&
      Boolean(newFileValidation.alertId) &&
      newFileValidation.describedBy.includes(newFileValidation.alertId) &&
      newFileValidation.focusedInput,
    newFileValidation,
  );
  await key("Escape");
  await wait(`!document.querySelector('[role="dialog"]')`, "CreateFileDialog closed");

  // 7. ProcessList count, column headers, and post-stop focus restoration to ProcessList Refresh
  const procHeaderState = await ev(`({
    countText: document.querySelector('.proc-count')?.textContent.trim(),
    hasHeaderRow: Boolean(document.querySelector('.proc-header-row')),
    hasPid1Spacer: Boolean(document.querySelector('.proc-row .proc-action-spacer')),
  })`);
  check(
    "ProcessList shows process count, desktop column headers, and aligned PID 1 spacer",
    procHeaderState.countText === "3 processes" &&
      procHeaderState.hasHeaderRow &&
      procHeaderState.hasPid1Spacer,
    procHeaderState,
  );

  await click(`document.querySelectorAll('.proc-kill-btn')[0]`, "click Stop on PID 42");
  await wait(`document.querySelector('[role="alertdialog"]')`, "stop process confirm dialog");
  await click(`document.querySelector('[role="alertdialog"] button.btn-danger')`, "confirm stop PID 42");
  await wait(`!document.querySelector('[role="alertdialog"]') && document.querySelector('.proc-count')?.textContent.trim() === '2 processes'`, "process stopped and refreshed");
  await paint();
  const focusAfterStopProc = await ev(`(()=>{
    const procSection = [...document.querySelectorAll('section')].find(s => s.getAttribute('aria-label') === 'Processes');
    const refreshBtn = [...(procSection?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === 'Refresh');
    return {
      isRefresh: document.activeElement === refreshBtn,
      activeTag: document.activeElement?.tagName,
      activeText: document.activeElement?.textContent?.trim(),
    };
  })()`);
  check(
    "stopping a process restores focus to ProcessList Refresh button rather than #main or body",
    focusAfterStopProc.isRefresh,
    focusAfterStopProc,
  );

  // 8. Mobile 375x812 JA check with Shell search open and FileDrawer open
  await cdp("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await click(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='日本語')`, "switch to Japanese on mobile");
  await click(`[...document.querySelectorAll('.shell-header-actions button')].find(b=>b.textContent.trim()==='検索')`, "open shell search on mobile JA");
  await paint();
  const mobileShellSearch = await ev(`({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    smallTargets: [...document.querySelectorAll('button, a, input')].filter(el => {
      if (el.classList.contains('skip-link')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.height < 44;
    }).map(el => ({ tag: el.tagName, cls: el.className, h: Math.round(el.getBoundingClientRect().height) })),
  })`);
  check(
    "375px Japanese Viewer with Shell search open has zero overflow and >=44px touch targets",
    !mobileShellSearch.overflow && mobileShellSearch.smallTargets.length === 0,
    mobileShellSearch,
  );

  await click(`[...document.querySelectorAll('.file-row-btn')].find(b=>b.textContent.includes('README.md'))`, "open README.md drawer on mobile JA");
  await wait(`document.querySelector('.drawer-panel textarea.file-editor')`, "drawer open on mobile JA");
  const mobileDrawer = await ev(`({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    drawerOverflow: (document.querySelector('.drawer-panel')?.scrollWidth ?? 0) > (document.querySelector('.drawer-panel')?.clientWidth ?? 0),
  })`);
  check(
    "375px Japanese FileDrawer has zero page or panel horizontal overflow",
    !mobileDrawer.overflow && !mobileDrawer.drawerOverflow,
    mobileDrawer,
  );

  check("no native browser dialogs opened", dialogs.length === 0, dialogs);
  check("no session created", creates === 0, creates);
  check("no uncaught page errors", errors.length === 0, errors);
  check("only synthetic endpoints reached", requests.every((x) => !x.kind.startsWith("forbidden")), requests.filter((x) => x.kind.startsWith("forbidden")));
  check("no external request forwarded", intercepted.every((x) => x.allowed), intercepted.filter((x) => !x.allowed));
} catch (e) {
  fatal = e.stack ?? e.message;
} finally {
  releaseStatus?.();
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      await bounded(Promise.allSettled([...tasks]), "interceptors");
      const closed = new Promise((r) => ws.addEventListener("close", r, { once: true }));
      ws.close();
      await bounded(closed, "ws close");
      cleanup.websocket = "closed";
    } catch (e) {
      cleanup.websocket = e.message;
    }
  }
  if (chrome) {
    if (chrome.exitCode === null) chrome.kill("SIGTERM");
    let exited = await bounded(chromeExit, "Chrome exit").catch(() => null);
    if (!exited) {
      chrome.kill("SIGKILL");
      exited = await bounded(chromeExit, "Chrome finalexit").catch(() => null);
    }
    cleanup.chrome = exited;
  }
  if (server.listening) {
    server.closeAllConnections();
    await bounded(new Promise((r, j) => server.close((e) => e ? j(e) : r())), "fixture close").then(() => cleanup.fixture = "closed").catch((e) => cleanup.fixture = e.message);
  }
  if (profile) await bounded(rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }), "private profile removal").then(() => cleanup.profile = "removed").catch((e) => cleanup.profile = e.message);
}

check("owned WebSocket closed and awaited", cleanup.websocket === "closed", cleanup.websocket);
check("owned fixture closed", cleanup.fixture === "closed", cleanup.fixture);
check("owned Chrome exited", cleanup.chrome?.code === 0, cleanup.chrome);
check("private profile removed", cleanup.profile === "removed", cleanup.profile);
check("request interceptors completed without error", interceptorErrors.length === 0, interceptorErrors);

const failed = assertions.filter((x) => !x.passed);
const result = {
  status: fatal ? "HARNESS_ERROR" : failed.length ? "RED" : "PASS",
  harnessSha256,
  scope: "Wave 5 interactive UI/UX regression (Dashboard IME search + desktop column wrapping, CreateModal validation a11y, Viewer deduplicated SR announcements + flicker-free polling + auto-refresh pause/resume, Shell line-wrap + IME-safe output search, ProcessList count/headers/focus restore, mobile 375px)",
  dashboardSha256: createHash("sha256").update(html).digest("hex"),
  browserVersion,
  chromeStderr,
  fatal,
  assertions,
  failed: failed.map((x) => x.name),
  actions,
  actionCount: actions.length,
  creates,
  statusCalls,
  dialogs,
  requests,
  intercepted,
  interceptorErrors,
  errors,
  snapshots,
  cleanup,
};
await writeFile(join(out, "REPORT.json"), JSON.stringify(result, null, 2) + "\n", { mode: 384 });
console.log(JSON.stringify({ status: result.status, failed: result.failed, fatal: result.fatal, actions: actions.length, creates, cleanup, report: join(out, "REPORT.json") }, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
