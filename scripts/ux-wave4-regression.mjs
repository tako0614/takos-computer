import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import { tmpdir } from "node:os";

const repo = resolve(process.env.COMPUTER_WAVE4_REPO ?? resolve(import.meta.dirname, ".."));
const out = resolve(process.env.COMPUTER_WAVE4_EVIDENCE ?? await mkdtemp(join(tmpdir(), "computer-wave4-evidence-")));
await mkdir(out, { recursive: true, mode: 448 });
const harnessSha256 = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
const html = await readFile(join(repo, "packages/computer-hosts/src/gui/app.html"));

// Valid 4x4 RGBA PNG bytes (used for inline image preview and shrunk-image reload).
const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR42mP8z8DwnwEJMDIyMDIwAAAl9AIFvH7C5AAAAABJRU5ErkJggg==",
  "base64",
);
const CORRUPT_PNG = Buffer.from("not-a-valid-png-payload");
const SVG_PAYLOAD = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>window.__svgXss=true</script></svg>');
const MULTI_CHUNK_BIN = Buffer.alloc(300 * 1024);
for (let i = 0; i < MULTI_CHUNK_BIN.length; i++) MULTI_CHUNK_BIN[i] = (i * 31 + 7) & 0xff;
const SHRUNK_BIN = Buffer.from([0xde, 0xad, 0xbe, 0xef]);

const FIVE_MB = 5 * 1024 * 1024;
const TWENTY_FIVE_MB = 25 * 1024 * 1024;

let sessions = [
  { sessionId: "alpha-active", spaceId: "space-a", userId: "u1", status: "active", createdAt: "2026-01-01T00:00:00.000Z" },
  { sessionId: "beta-starting", spaceId: "space-a", userId: "u2", status: "starting", createdAt: "2026-01-01T00:01:00.000Z" },
  { sessionId: "gamma-stopped", spaceId: "space-b", userId: "u3", status: "stopped", createdAt: "2026-01-01T00:02:00.000Z" },
];
let oversizedImgShrunk = false;
let hugeBinShrunk = false;

const requests = [], actions = [], assertions = [], errors = [], intercepted = [], interceptorErrors = [], snapshots = {};
const pending = new Map(), tasks = new Set();
const dialogs = [], destroyRequests = [], fileReadCalls = [];
let nextId = 1, ws, chrome, chromeExit, profile, fixturePort, debugPort, fatal = null;
let chromeStderr = "";
let creates = 0, cleanup = {}, browserVersion;

const send = (res, status, body) => {
  if (!res.headersSent) res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

function sliceRead(buf, offset, limit, encoding) {
  const start = Math.max(0, Number(offset ?? 0));
  const max = Math.min(256 * 1024, Math.max(0, Number(limit ?? 256 * 1024)));
  const chunk = buf.subarray(start, Math.min(buf.length, start + max));
  const truncated = start + chunk.length < buf.length;
  return {
    content: encoding === "base64" ? chunk.toString("base64") : chunk.toString("utf8"),
    size: buf.length,
    truncated,
  };
}

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
    const delMatch = u.pathname.match(/^\/gui\/api\/sandbox-session\/([^/]+)$/);
    if (delMatch && req.method === "DELETE") {
      const id = decodeURIComponent(delMatch[1]);
      destroyRequests.push(id);
      requests.push({ kind: "session-delete", id });
      sessions = sessions.filter((s) => s.sessionId !== id);
      return send(res, 200, { ok: true });
    }
    if (delMatch && req.method === "GET") {
      const id = decodeURIComponent(delMatch[1]);
      const found = sessions.find((s) => s.sessionId === id);
      if (!found) return send(res, 404, { error: "not found" });
      return send(res, 200, found);
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
        payload = { processes: [] };
      } else if (tool === "file_list") {
        const dir = args.path ?? ".";
        if (dir === "./sub" || dir === "sub") {
          payload = {
            entries: [
              { name: "nested.txt", type: "file", size: 12, modified: "2026-01-01T00:00:00.000Z" },
            ],
          };
        } else {
          payload = {
            entries: [
              { name: "sub", type: "directory", size: 0, modified: "2026-01-01T00:00:00.000Z" },
              { name: "preview.png", type: "file", size: VALID_PNG.length, modified: "2026-01-01T00:00:00.000Z" },
              { name: "oversized.png", type: "file", size: FIVE_MB, modified: "2026-01-01T00:00:00.000Z" },
              { name: "corrupt.png", type: "file", size: CORRUPT_PNG.length, modified: "2026-01-01T00:00:00.000Z" },
              { name: "vector.svg", type: "file", size: SVG_PAYLOAD.length, modified: "2026-01-01T00:00:00.000Z" },
              { name: "archive.bin", type: "file", size: MULTI_CHUNK_BIN.length, modified: "2026-01-01T00:00:00.000Z" },
              { name: "huge.bin", type: "file", size: TWENTY_FIVE_MB, modified: "2026-01-01T00:00:00.000Z" },
              { name: "README.md", type: "file", size: 14, modified: "2026-01-01T00:00:00.000Z" },
            ],
          };
        }
      } else if (tool === "file_read") {
        fileReadCalls.push({ path: args.path, offset: args.offset, limit: args.limit, encoding: args.encoding });
        const p = String(args.path ?? "");
        if (p.endsWith("/preview.png")) {
          payload = sliceRead(VALID_PNG, args.offset, args.limit, args.encoding);
        } else if (p.endsWith("/oversized.png")) {
          if (oversizedImgShrunk) {
            payload = sliceRead(VALID_PNG, args.offset, args.limit, args.encoding);
          } else {
            payload = { content: "", size: FIVE_MB, truncated: true };
          }
        } else if (p.endsWith("/corrupt.png")) {
          payload = sliceRead(CORRUPT_PNG, args.offset, args.limit, args.encoding);
        } else if (p.endsWith("/vector.svg")) {
          payload = sliceRead(SVG_PAYLOAD, args.offset, args.limit, args.encoding);
        } else if (p.endsWith("/archive.bin")) {
          payload = sliceRead(MULTI_CHUNK_BIN, args.offset, args.limit, args.encoding);
        } else if (p.endsWith("/huge.bin")) {
          if (hugeBinShrunk) {
            payload = sliceRead(SHRUNK_BIN, args.offset, args.limit, args.encoding);
          } else {
            payload = { content: "AA==", size: TWENTY_FIVE_MB, truncated: true };
          }
        } else {
          payload = sliceRead(Buffer.from("# hello world\n"), args.offset, args.limit, args.encoding);
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
async function key(k, code = k) {
  actions.push({ action: "key " + k, kind: "keyboard", at: Date.now() });
  const keyCodeMap = {
    Tab: 9, Enter: 13, Escape: 27,
    End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  };
  const keyCode = keyCodeMap[k] ?? 0;
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
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
  profile = await mkdtemp(join(tmpdir(), "computer-wave4-chrome-"));
  chrome = spawn("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--password-store=basic", "--disable-extensions", "--disable-background-networking",
    "--disable-component-update", "--disable-sync", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
    `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  chrome.stderr.on("data", (chunk) => {
    chromeStderr = (chromeStderr + chunk.toString()).slice(0, 65536);
  });
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
  await wait(`document.querySelectorAll('tbody tr').length===3`, "initial 3 sessions");

  // Install non-invasive ObjectURL & download spies
  await ev(`(()=>{
    window.__wave4Spy = { blobs: new Map(), createdUrls: [], revokedUrls: [], downloads: [] };
    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = function(blob) {
      const url = origCreate(blob);
      window.__wave4Spy.blobs.set(url, blob);
      window.__wave4Spy.createdUrls.push(url);
      return url;
    };
    URL.revokeObjectURL = function(url) {
      window.__wave4Spy.revokedUrls.push(url);
      return origRevoke(url);
    };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      if (this.download && this.href && this.href.startsWith('blob:')) {
        const blob = window.__wave4Spy.blobs.get(this.href);
        const rec = { filename: this.download, size: blob ? blob.size : -1, type: blob ? blob.type : '', first4: null, last4: null };
        window.__wave4Spy.downloads.push(rec);
        if (blob) {
          blob.arrayBuffer().then((ab) => {
            const bytes = new Uint8Array(ab);
            rec.actualLen = bytes.length;
            rec.first4 = Array.from(bytes.slice(0, 4));
            rec.last4 = Array.from(bytes.slice(-4));
          });
        }
        return;
      }
      return origClick.apply(this, arguments);
    };
  })()`);

  // 1. Dashboard status filter radiogroup (counts, roving tabindex, Arrow/Home/End, combined filter + Clear filter)
  const initialRadios = await ev(`(()=>{
    const group = document.querySelector('[role="radiogroup"]');
    const radios = [...document.querySelectorAll('[role="radiogroup"] [role="radio"]')];
    return {
      hasGroup: Boolean(group),
      count: radios.length,
      labels: radios.map((r) => r.textContent.trim().replace(/\\s+/g, ' ')),
      checked: radios.map((r) => r.getAttribute('aria-checked')),
      tabIndexes: radios.map((r) => r.tabIndex),
    };
  })()`);
  check(
    "status filter radiogroup renders 4 chips with counts and roving tabindex",
    initialRadios.hasGroup &&
      initialRadios.count === 4 &&
      initialRadios.checked.join(",") === "true,false,false,false" &&
      initialRadios.tabIndexes.join(",") === "0,-1,-1,-1" &&
      initialRadios.labels[0].includes("3") &&
      initialRadios.labels[1].includes("1") &&
      initialRadios.labels[2].includes("1") &&
      initialRadios.labels[3].includes("1"),
    initialRadios,
  );

  await click(`document.querySelectorAll('[role="radiogroup"] [role="radio"]')[0]`, "focus All status chip");
  await key("ArrowRight");
  await paint();
  const afterArrowRight = await ev(`({
    rows: [...document.querySelectorAll('tbody tr td.session-id-cell')].map(e=>e.textContent.trim()),
    activeChecked: document.activeElement?.getAttribute('aria-checked'),
    activeText: document.activeElement?.textContent.trim(),
  })`);
  check(
    "ArrowRight on status radiogroup selects Active chip and filters rows",
    afterArrowRight.rows.length === 1 &&
      afterArrowRight.rows[0] === "alpha-active" &&
      afterArrowRight.activeChecked === "true" &&
      afterArrowRight.activeText.includes("Active"),
    afterArrowRight,
  );

  await key("End");
  await paint();
  const afterEnd = await ev(`([...document.querySelectorAll('tbody tr td.session-id-cell')].map(e=>e.textContent.trim()))`);
  check("End key selects Stopped chip", afterEnd.length === 1 && afterEnd[0] === "gamma-stopped", afterEnd);

  // Combine search + status -> empty match -> Clear filter resets both
  await click(`document.querySelector('input.session-search-input')`, "focus session search");
  await typeText("alpha");
  await paint();
  const combinedEmpty = await ev(`document.querySelector('tbody')?.textContent ?? ''`);
  check("combined status + search mismatch shows empty-filter state", combinedEmpty.includes("No matching sessions"), combinedEmpty);

  await click(`document.querySelector('tbody button')`, "click Clear filter in empty table");
  await paint();
  const afterClear = await ev(`({
    rows: document.querySelectorAll('tbody tr td.session-id-cell').length,
    searchVal: document.querySelector('input.session-search-input')?.value,
    allChecked: document.querySelectorAll('[role="radiogroup"] [role="radio"]')[0]?.getAttribute('aria-checked'),
  })`);
  check(
    "Clear filter resets both search input and status chip to All",
    afterClear.rows === 3 && afterClear.searchVal === "" && afterClear.allChecked === "true",
    afterClear,
  );

  // 2. Dashboard auto-refresh pause/resume button (no contradictory aria-pressed + live status span)
  const refreshBefore = await ev(`(()=>{
    const btn = document.querySelector('.footer-refresh-toggle');
    const status = document.querySelector('.footer-note-info [role="status"][aria-live="polite"]');
    return {
      hasAriaPressed: btn?.hasAttribute('aria-pressed'),
      label: btn?.textContent.trim(),
      statusText: status?.textContent.trim(),
      statusIncludesLastUpdated: status?.textContent.includes('Updated') ?? false,
    };
  })()`);
  check(
    "auto-refresh toggle uses action label without contradictory aria-pressed and separates live status",
    refreshBefore.hasAriaPressed === false &&
      refreshBefore.label === "Pause auto-refresh" &&
      refreshBefore.statusText === "Auto-refresh: every 10s" &&
      refreshBefore.statusIncludesLastUpdated === false,
    refreshBefore,
  );

  await click(`document.querySelector('.footer-refresh-toggle')`, "pause auto-refresh");
  await paint();
  const refreshPaused = await ev(`({
    hasAriaPressed: document.querySelector('.footer-refresh-toggle')?.hasAttribute('aria-pressed'),
    label: document.querySelector('.footer-refresh-toggle')?.textContent.trim(),
    statusText: document.querySelector('.footer-note-info [role="status"][aria-live="polite"]')?.textContent.trim(),
  })`);
  check(
    "pausing auto-refresh updates button label and polite status span cleanly",
    refreshPaused.hasAriaPressed === false &&
      refreshPaused.label === "Resume auto-refresh" &&
      refreshPaused.statusText === "Auto-refresh: paused",
    refreshPaused,
  );

  await click(`document.querySelector('.footer-refresh-toggle')`, "resume auto-refresh");
  await paint();
  const refreshResumed = await ev(`document.querySelector('.footer-refresh-toggle')?.textContent.trim()`);
  check("resuming auto-refresh restores Pause label", refreshResumed === "Pause auto-refresh", refreshResumed);

  // 3. Post-delete focus restoration: confirming deletion removes row and moves focus to Refresh sessions (NOT document.body)
  await click(`document.querySelector('button[data-session-delete="gamma-stopped"]')`, "open delete dialog for gamma-stopped");
  await wait(`document.querySelector('[role="alertdialog"]')`, "confirm delete dialog");
  await click(`document.querySelector('[role="alertdialog"] button.btn-danger')`, "confirm delete gamma-stopped");
  await wait(`!document.querySelector('[role="alertdialog"]')`, "confirm dialog closed");
  await wait(`document.querySelectorAll('tbody tr td.session-id-cell').length===2`, "deleted row removed after reload");
  await paint();
  const focusAfterDelete = await ev(`({
    tag: document.activeElement?.tagName,
    text: document.activeElement?.textContent?.trim(),
    isBody: document.activeElement === document.body,
  })`);
  check(
    "post-delete reload restores focus to Refresh sessions instead of dropping to document.body",
    !focusAfterDelete.isBody && focusAfterDelete.tag === "BUTTON" && focusAfterDelete.text === "Refresh sessions",
    focusAfterDelete,
  );

  // 4. Open alpha-active Viewer and test FileBrowser filter + IME safety + Tab/selector contracts
  await click(`document.querySelector('tbody a[href$="/sandbox/alpha-active"]')`, "open alpha-active viewer");
  await wait(`document.querySelector('.file-filter-input')`, "file filter input rendered");

  const selectorContracts = await ev(`({
    monoInputCount: document.querySelectorAll('input.input-mono').length,
    monoInputValue: document.querySelector('input.input-mono')?.value,
    filterHasMono: document.querySelector('.file-filter-input')?.classList.contains('input-mono'),
  })`);
  check(
    "FileBrowser preserves single input.input-mono selector for directory path",
    selectorContracts.monoInputCount === 1 && selectorContracts.monoInputValue === "." && !selectorContracts.filterHasMono,
    selectorContracts,
  );

  await click(`document.querySelector('input.input-mono')`, "focus directory path input");
  await key("Tab");
  const tabAfterPath = await ev(`document.activeElement?.textContent?.trim()`);
  check("Tab from directory path input still moves to Refresh button", tabAfterPath === "Refresh", tabAfterPath);

  // IME composition guard on file-filter-input (does not filter mid-composition, commits on compositionend)
  const imeResult = await ev(`(()=>{
    const input = document.querySelector('.file-filter-input');
    input.focus();
    input.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    input.value = 'ｐｎｇ';
    input.dispatchEvent(new InputEvent('input', { data: 'ｐｎｇ', isComposing: true, bubbles: true }));
    const duringRows = document.querySelectorAll('.panel-scroll .file-name').length;
    const duringVal = input.value;
    input.value = 'png';
    input.dispatchEvent(new CompositionEvent('compositionend', { data: 'png', bubbles: true }));
    return { duringRows, duringVal };
  })()`);
  await paint();
  const afterImeRows = await ev(`document.querySelectorAll('.panel-scroll .file-name').length`);
  check(
    "file-filter-input guards IME composition and commits filter on compositionend",
    imeResult.duringRows === 8 && imeResult.duringVal === "ｐｎｇ" && afterImeRows === 3,
    { imeResult, afterImeRows },
  );
  await key("Escape");
  await paint();

  await click(`document.querySelector('.file-filter-input')`, "focus file filter");
  await typeText("png");
  await paint();
  const filteredFiles = await ev(`({
    names: [...document.querySelectorAll('.panel-scroll .file-name')].map(e=>e.textContent.trim()),
    count: document.querySelector('.file-count')?.textContent.trim(),
  })`);
  check(
    "file filter narrows visible entries and updates live match count",
    filteredFiles.names.length === 3 &&
      filteredFiles.names.every((n) => n.endsWith(".png")) &&
      filteredFiles.count === "3 of 8 items",
    filteredFiles,
  );

  // Escape clears file filter
  await key("Escape");
  await paint();
  const afterEscFilter = await ev(`({
    val: document.querySelector('.file-filter-input')?.value,
    rows: document.querySelectorAll('.panel-scroll .file-name').length,
  })`);
  check("Escape clears file filter and restores all entries", afterEscFilter.val === "" && afterEscFilter.rows === 8, afterEscFilter);

  // Non-matching filter -> empty state -> Clear filter returns focus to input
  await typeText("nonexistent-xyz");
  await paint();
  await wait(`document.querySelector('.file-filter-empty button')`, "empty file filter Clear button");
  await click(`document.querySelector('.file-filter-empty button')`, "clear empty file filter");
  await paint();
  const afterClearFileFilter = await ev(`({
    val: document.querySelector('.file-filter-input')?.value,
    focusedFilter: document.activeElement === document.querySelector('.file-filter-input'),
  })`);
  check(
    "empty-filter Clear button clears query and returns focus to file filter input",
    afterClearFileFilter.val === "" && afterClearFileFilter.focusedFilter,
    afterClearFileFilter,
  );

  // Directory navigation resets file filter
  await typeText("sub");
  await paint();
  await click(`[...document.querySelectorAll('.file-row')].find(r=>r.textContent.includes('sub'))`, "enter sub directory");
  await wait(`document.querySelector('.panel-scroll')?.textContent.includes('nested.txt')`, "sub directory loaded");
  const filterAfterNav = await ev(`document.querySelector('.file-filter-input')?.value`);
  check("navigating into subdirectory resets file filter", filterAfterNav === "", filterAfterNav);

  // Return to workspace root via breadcrumb
  await click(`document.querySelector('.breadcrumb-btn')`, "return to root via breadcrumb");
  await wait(`document.querySelector('.panel-scroll')?.textContent.includes('preview.png')`, "root files restored");

  // 5. FileDrawer inline image preview + download + ObjectURL lifecycle
  await click(`[...document.querySelectorAll('.file-row')].find(r=>r.textContent.includes('preview.png'))`, "open preview.png");
  await wait(`document.querySelector('.drawer-image-preview')?.complete && document.querySelector('.drawer-image-preview')?.naturalWidth === 4`, "preview.png rendered");
  const previewState = await ev(`({
    naturalWidth: document.querySelector('.drawer-image-preview')?.naturalWidth,
    naturalHeight: document.querySelector('.drawer-image-preview')?.naturalHeight,
    src: document.querySelector('.drawer-image-preview')?.getAttribute('src'),
    meta: document.querySelector('.drawer-meta')?.textContent.trim(),
    downloadPrimary: [...document.querySelectorAll('.drawer-actions button')].find(b=>b.textContent.trim()==='Download')?.classList.contains('btn-primary'),
  })`);
  check(
    "preview.png renders inline with 4x4 natural dimensions and primary Download button",
    previewState.naturalWidth === 4 &&
      previewState.naturalHeight === 4 &&
      previewState.meta.includes("4×4 px") &&
      previewState.downloadPrimary === true,
    previewState,
  );

  await click(`[...document.querySelectorAll('.drawer-actions button')].find(b=>b.textContent.trim()==='Download')`, "download preview.png");
  await wait(`window.__wave4Spy.downloads.length === 1 && window.__wave4Spy.downloads[0].actualLen === ${VALID_PNG.length}`, "preview.png blob download recorded");
  await click(`document.querySelector('.drawer-header button[aria-label="Close"]')`, "close preview.png drawer");
  await wait(`!document.querySelector('.drawer-panel')`, "drawer closed");

  const previewUrlRevoked = await ev(`window.__wave4Spy.revokedUrls.includes(${JSON.stringify(previewState.src)})`);
  check("closing image drawer immediately revokes preview ObjectURL", previewUrlRevoked, { src: previewState.src });

  // 6. Oversized image (>4 MB) -> explicit Reload after server shrinks it bypasses stale file.size and previews!
  await click(`[...document.querySelectorAll('.file-row')].find(r=>r.textContent.includes('oversized.png'))`, "open oversized.png");
  await wait(`document.querySelector('.drawer-panel .info-banner')?.textContent.includes('too large for inline preview')`, "oversized image notice");
  oversizedImgShrunk = true;
  await click(`[...document.querySelectorAll('.drawer-actions button')].find(b=>b.textContent.trim()==='Reload')`, "reload shrunk oversized.png");
  await wait(`document.querySelector('.drawer-image-preview')?.complete && document.querySelector('.drawer-image-preview')?.naturalWidth === 4`, "reloaded shrunk image preview");
  const reloadedImg = await ev(`({
    w: document.querySelector('.drawer-image-preview')?.naturalWidth,
    status: document.querySelector('.drawer-body .status-banner')?.textContent.trim(),
  })`);
  check(
    "explicit Reload on oversized image bypasses stale file.size and renders shrunk image",
    reloadedImg.w === 4 && reloadedImg.status === "Reloaded from workspace",
    reloadedImg,
  );
  await click(`document.querySelector('.drawer-header button[aria-label="Close"]')`, "close oversized.png drawer");
  await wait(`!document.querySelector('.drawer-panel')`, "drawer closed");

  // 7. Corrupt image fallback
  await click(`[...document.querySelectorAll('.file-row')].find(r=>r.textContent.includes('corrupt.png'))`, "open corrupt.png");
  await wait(`document.querySelector('.drawer-panel .info-banner')?.textContent.includes('Could not preview this image')`, "corrupt image fallback");
  const corruptHasDownload = await ev(`Boolean([...document.querySelectorAll('.drawer-actions button')].find(b=>b.textContent.trim()==='Download' && !b.disabled))`);
  check("corrupt image shows fallback notice while keeping Download enabled", corruptHasDownload, corruptHasDownload);
  await click(`document.querySelector('.drawer-header button[aria-label="Close"]')`, "close corrupt.png drawer");
  await wait(`!document.querySelector('.drawer-panel')`, "drawer closed");

  // 8. SVG excluded from inline <img> preview and script does not execute
  await click(`[...document.querySelectorAll('.file-row')].find(r=>r.textContent.includes('vector.svg'))`, "open vector.svg");
  await wait(`document.querySelector('.drawer-panel textarea.file-editor')`, "vector.svg opens in text editor");
  const svgCheck = await ev(`({ hasImg: Boolean(document.querySelector('.drawer-image-preview')), xss: Boolean(window.__svgXss) })`);
  check("SVG is excluded from inline image preview and never executes scripts", !svgCheck.hasImg && !svgCheck.xss, svgCheck);
  await click(`document.querySelector('.drawer-header button[aria-label="Close"]')`, "close vector.svg drawer");
  await wait(`!document.querySelector('.drawer-panel')`, "drawer closed");

  // 9. Multi-chunk 300 KB binary download (byte-exact across 2 chunks)
  await click(`[...document.querySelectorAll('.file-row')].find(r=>r.textContent.includes('archive.bin'))`, "open archive.bin");
  await wait(`document.querySelector('.drawer-panel .info-banner')?.textContent.includes('cannot be edited as text')`, "archive.bin binary notice");
  await click(`[...document.querySelectorAll('.drawer-actions button')].find(b=>b.textContent.trim()==='Download')`, "download 300KB archive.bin");
  await wait(`window.__wave4Spy.downloads.length === 2 && window.__wave4Spy.downloads[1].actualLen === ${MULTI_CHUNK_BIN.length}`, "300KB archive.bin download completed");
  const binDl = await ev(`window.__wave4Spy.downloads[1]`);
  const expectedFirst4 = Array.from(MULTI_CHUNK_BIN.subarray(0, 4));
  const expectedLast4 = Array.from(MULTI_CHUNK_BIN.subarray(-4));
  check(
    "multi-chunk binary download reassembles 300 KB byte-exact",
    binDl.filename === "archive.bin" &&
      binDl.actualLen === MULTI_CHUNK_BIN.length &&
      JSON.stringify(binDl.first4) === JSON.stringify(expectedFirst4) &&
      JSON.stringify(binDl.last4) === JSON.stringify(expectedLast4),
    binDl,
  );
  await click(`document.querySelector('.drawer-header button[aria-label="Close"]')`, "close archive.bin drawer");
  await wait(`!document.querySelector('.drawer-panel')`, "drawer closed");

  // 10. >20 MB binary live-size probe guard + recovery when file shrinks
  await click(`[...document.querySelectorAll('.file-row')].find(r=>r.textContent.includes('huge.bin'))`, "open huge.bin");
  await wait(`document.querySelector('.drawer-panel .info-banner')`, "huge.bin binary notice");
  await click(`[...document.querySelectorAll('.drawer-actions button')].find(b=>b.textContent.trim()==='Download')`, "attempt >20MB huge.bin download");
  await wait(`document.querySelector('.drawer-body [role="alert"]')?.textContent.includes('too large to download')`, "downloadTooLarge alert");
  hugeBinShrunk = true;
  await click(`[...document.querySelectorAll('.drawer-actions button')].find(b=>b.textContent.trim()==='Download')`, "download shrunk huge.bin");
  await wait(`window.__wave4Spy.downloads.length === 3 && window.__wave4Spy.downloads[2].actualLen === 4`, "shrunk huge.bin download completed");
  const shrunkDl = await ev(`window.__wave4Spy.downloads[2]`);
  check(
    ">20 MB binary rejects when oversized and downloads via live probe once shrunk",
    shrunkDl.filename === "huge.bin" &&
      shrunkDl.actualLen === 4 &&
      JSON.stringify(shrunkDl.first4) === JSON.stringify([0xde, 0xad, 0xbe, 0xef]),
    shrunkDl,
  );
  await click(`document.querySelector('.drawer-header button[aria-label="Close"]')`, "close huge.bin drawer");
  await wait(`!document.querySelector('.drawer-panel')`, "drawer closed");

  // Wait for 1000ms download URL revocation timers and verify 0 leaked ObjectURLs
  await delay(1150);
  const urlAudit = await ev(`({
    created: window.__wave4Spy.createdUrls.length,
    revoked: window.__wave4Spy.revokedUrls.length,
    unrevoked: window.__wave4Spy.createdUrls.filter(u => !window.__wave4Spy.revokedUrls.includes(u)),
  })`);
  check("zero leaked ObjectURLs across previews and downloads", urlAudit.created > 0 && urlAudit.unrevoked.length === 0, urlAudit);

  // 11. Mobile 375x812 overflow & touch target check (Viewer + Dashboard in JA)
  await cdp("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await click(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='日本語')`, "switch to Japanese");
  await paint();
  const mobileViewer = await ev(`({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    smallTargets: [...document.querySelectorAll('button, a, input')].filter(el => {
      if (el.classList.contains('skip-link')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.height < 44;
    }).map(el => ({ tag: el.tagName, cls: el.className, h: Math.round(el.getBoundingClientRect().height) })),
  })`);
  check("375px Japanese Viewer has no horizontal overflow and >=44px touch targets", !mobileViewer.overflow && mobileViewer.smallTargets.length === 0, mobileViewer);

  await click(`document.querySelector('header a')`, "return to Dashboard on mobile");
  await wait(`document.querySelector('.status-filter-group')`, "mobile Dashboard status chips");
  await paint();
  const mobileDash = await ev(`({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    smallTargets: [...document.querySelectorAll('button, a, input')].filter(el => {
      if (el.classList.contains('skip-link')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.height < 44;
    }).map(el => ({ tag: el.tagName, cls: el.className, h: Math.round(el.getBoundingClientRect().height) })),
  })`);
  check("375px Japanese Dashboard has no horizontal overflow and >=44px touch targets", !mobileDash.overflow && mobileDash.smallTargets.length === 0, mobileDash);

  check("no native browser dialogs opened", dialogs.length === 0, dialogs);
  check("no session created", creates === 0, creates);
  check("no uncaught page errors", errors.length === 0, errors);
  check("only synthetic endpoints reached", requests.every((x) => !x.kind.startsWith("forbidden")), requests.filter((x) => x.kind.startsWith("forbidden")));
  check("no external request forwarded", intercepted.every((x) => x.allowed), intercepted.filter((x) => !x.allowed));
} catch (e) {
  fatal = e.stack ?? e.message;
} finally {
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
  scope: "Wave 4 interactive UI/UX regression (status radiogroup, auto-refresh pause/resume, post-delete focus restoration, file filter + IME/tab contracts, image preview/reload, chunked download, mobile 375px)",
  dashboardSha256: createHash("sha256").update(html).digest("hex"),
  browserVersion,
  chromeStderr,
  fatal,
  assertions,
  failed: failed.map((x) => x.name),
  actions,
  actionCount: actions.length,
  creates,
  destroyRequests,
  fileReadCalls,
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
