// Optional real-dashboard browser regression with synthetic loopback endpoints.
// Run with TMPDIR on disk and COMPUTER_FLOW_EVIDENCE set to a private directory.
// No real account, host tool, session creation, or provider service is used.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import { tmpdir } from "node:os";
const repo = resolve(process.env.COMPUTER_FLOW_REPO ?? resolve(import.meta.dirname, ".."));
const out = resolve(process.env.COMPUTER_FLOW_EVIDENCE ?? await mkdtemp(join(tmpdir(), "computer-file-flow-evidence-")));
await mkdir(out, { recursive: true, mode: 448 });
const html = await readFile(join(repo, "packages/computer-hosts/src/gui/app.html"));
const requests = [], actions = [], assertions = [], errors = [], intercepted = [], interceptorErrors = [], snapshots = {};
const pending = /* @__PURE__ */ new Map(), tasks = /* @__PURE__ */ new Set();
let nextId = 1, ws, chrome, chromeExit, profile, fixturePort, debugPort, fatal = null, mode = "rows", releaseList = null;
let creates = 0, cleanup = {}, browserVersion;
const entry = (name, type = "file") => ({ name, type, size: 24, modified: "2026-01-01T00:00:00.000Z" });
const longName = "long-directory-name-".repeat(9);
const session = { sessionId: "synthetic", spaceId: "fixture", userId: "fixture", status: "active", createdAt: "2026-01-01T00:00:00.000Z" };
const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && ["/gui", "/gui/", "/gui/sandbox/synthetic"].includes(u.pathname)) {
      requests.push({ kind: "dashboard", method: req.method, path: u.pathname });
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      return res.end(html);
    }
    if (req.method === "GET" && u.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "GET" && u.pathname === "/gui/api/sandbox-sessions") {
      requests.push({ kind: "session-list" });
      return send(res, 200, { sessions: [session] });
    }
    if (req.method === "GET" && u.pathname === "/gui/api/sandbox-session/synthetic") {
      requests.push({ kind: "session-status" });
      return send(res, 200, session);
    }
    if (req.method === "POST" && u.pathname === "/gui/api/sandbox-create") {
      creates++;
      requests.push({ kind: "forbidden-create" });
      return send(res, 403, { error: "fixture never creates sessions" });
    }
    if (req.method === "POST" && u.pathname === "/gui/api/sandbox-session/synthetic/mcp") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const call = JSON.parse(raw), tool = call.params?.name, path = call.params?.arguments?.path;
      requests.push({ kind: "synthetic-tool", tool, path, mode });
      let result2;
      if (tool === "process_list") result2 = { content: [{ type: "text", text: '{"processes":[]}' }] };
      else if (tool !== "file_list") {
        requests.push({ kind: "forbidden-tool", tool });
        return send(res, 403, { error: "only synthetic file_list/process_list allowed" });
      } else {
        const selectedMode = mode;
        if (selectedMode === "held") await new Promise((resolve2) => {
          releaseList = resolve2;
        });
        if (selectedMode === "http-error") return send(res, 503, { error: "Synthetic directory service unavailable" });
        if (selectedMode === "tool-error") result2 = { isError: true, content: [{ type: "text", text: "Synthetic directory listing refused" }] };
        else {
          let body;
          if (selectedMode === "malformed") body = {};
          else if (selectedMode === "invalid-row") body = { entries: [null] };
          else if (selectedMode === "bad-type") body = { entries: [{ ...entry("bad"), type: ["file"] }] };
          else if (selectedMode === "valid-kinds") body = { entries: [entry("linked", "symlink"), { ...entry("unknown-kind", "unknown"), modified: null }] };
          else if (selectedMode === "empty") body = { entries: [] };
          else if (path === ".") body = { entries: [entry("documents", "directory"), entry(longName, "directory"), entry("notes.txt")] };
          else if (path === "./documents") body = { entries: [entry("draft.md"), entry("archive", "directory")] };
          else if (path === "./documents/archive") body = { entries: [entry("retained.txt")] };
          else return send(res, 200, { jsonrpc: "2.0", id: call.id, result: { isError: true, content: [{ type: "text", text: "Synthetic outside workspace refusal" }] } });
          result2 = { content: [{ type: "text", text: JSON.stringify(body) }] };
        }
      }
      return send(res, 200, { jsonrpc: "2.0", id: call.id, result: result2 });
    }
    requests.push({ kind: "forbidden-route", method: req.method, path: u.pathname });
    return send(res, 404, { error: "synthetic fixture only" });
  } catch (e) {
    errors.push("fixture: " + e.message);
    if (!res.headersSent) send(res, 500, { error: "fixture failure" });
    else res.end();
  }
});
const bounded = (p, label, ms = 5e3) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(label + " timed out")), ms);
  })]).finally(() => clearTimeout(t));
};
const listen = (s) => new Promise((yes, no) => {
  s.once("error", no);
  s.listen(0, "127.0.0.1", () => yes(s.address().port));
});
async function reserve() {
  const s = net.createServer(), p = await listen(s);
  await new Promise((r) => s.close(r));
  return p;
}
function cdp(method, params = {}) {
  const id = nextId++;
  return new Promise((yes, no) => {
    const t = setTimeout(() => {
      pending.delete(id);
      no(new Error("CDP " + method + " timeout"));
    }, 1e4);
    pending.set(id, { yes: (v) => {
      clearTimeout(t);
      yes(v);
    }, no: (e) => {
      clearTimeout(t);
      no(e);
    } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expression) {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}
function check(name, pass, actual) {
  assertions.push({ name, passed: !!pass, actual });
}
async function wait(expression, label, ms = 3e3) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    v = await ev(expression);
    if (v) return v;
    await delay(30);
  }
  throw new Error(label + " did not settle");
}
async function key(key2, code = key2, modifiers = 0) {
  const text = key2 === "Enter" ? "\r" : key2 === " " ? " " : void 0;
  actions.push({ action: "key " + key2, kind: "keyboard", at: Date.now() });
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: key2, code, modifiers, text, unmodifiedText: text, windowsVirtualKeyCode: key2 === "Tab" ? 9 : key2 === "Enter" ? 13 : key2 === "Escape" ? 27 : key2 === " " ? 32 : 0 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: key2, code, modifiers });
}
async function click(expression, label) {
  const rect = await ev(`(()=>{const e=${expression};if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if (!rect) throw new Error("missing action " + label);
  actions.push({ action: label, kind: "pointer", at: Date.now() });
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...rect });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...rect });
}
const button = (text) => `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
const folder = `[...document.querySelectorAll('span')].find(e=>e.textContent.trim()==='documents')`;
const filesRoot = `[...document.querySelectorAll('span')].find(e=>e.textContent.trim()==='Files')?.parentElement?.parentElement`;
const cwd = `document.querySelector('input.input-mono')`;
async function setPath(path) {
  await ev(`(()=>{const e=${cwd};if(!e)throw Error('missing path');e.focus();e.select();})()`);
  await cdp("Input.insertText", { text: path });
  actions.push({ action: "edit path " + path, kind: "keyboard", at: Date.now() });
}
async function refresh() {
  await click(`(${filesRoot})?.querySelector('button')`, "file Refresh");
}
async function snap(name) {
  const v = await ev(`(()=>{const r=${filesRoot},i=${cwd},d=document.querySelector('[role=dialog]');return {url:location.pathname+location.search,cwd:i?.value??null,fileText:r?.innerText??null,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent.trim()),body:document.body.innerText,focus:{tag:document.activeElement?.tagName,name:document.activeElement?.getAttribute('name'),text:document.activeElement?.textContent?.trim().slice(0,70)},dialog:d?{name:document.getElementById(d.getAttribute('aria-labelledby'))?.textContent,inputs:[...d.querySelectorAll('input')].map(e=>({name:e.name,value:e.value,labels:e.labels.length})),busy:d.getAttribute('aria-busy')}:null,viewport:{width:innerWidth,bodyScroll:document.documentElement.scrollWidth,bodyClient:document.documentElement.clientWidth,fileScroll:r?.scrollWidth,fileClient:r?.clientWidth},};})()`);
  snapshots[name] = v;
  const image = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(join(out, name + ".png"), Buffer.from(image.data, "base64"), { mode: 384 });
  return v;
}
async function navigate(path) {
  await cdp("Page.navigate", { url: `http://127.0.0.1:${fixturePort}${path}` });
  await wait(`document.readyState==='complete'&&!!document.querySelector('#app')?.children.length`, "app load");
}
try {
  fixturePort = await listen(server);
  debugPort = await reserve();
  profile = await mkdtemp(join(tmpdir(), "computer-flow-chrome-"));
  chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
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
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT", signal: AbortSignal.timeout(1e3) })).json();
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
      m.error ? p.no(Error(m.error.message)) : p.yes(m.result ?? {});
    } else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === "Fetch.requestPaused") {
      const u = new URL(m.params.request.url);
      const allowed = u.origin === `http://127.0.0.1:${fixturePort}`;
      intercepted.push({ origin: u.origin, method: m.params.request.method, path: u.pathname, allowed });
      const t = cdp(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", allowed ? { requestId: m.params.requestId } : { requestId: m.params.requestId, errorReason: "BlockedByClient" }).catch((e) => interceptorErrors.push(e.message)).finally(() => tasks.delete(t));
      tasks.add(t);
    }
  });
  ws.addEventListener("close", () => {
    for (const p of pending.values()) p.no(Error("CDP closed"));
    pending.clear();
  });
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Network.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  if (process.env.COMPUTER_FLOW_FAULT === "missing-dom") {
    await navigate("/gui");
    await wait(`document.querySelector('[data-forced-missing-fixture]')`, "intentional missing DOM", 300);
  }
  await navigate("/gui");
  await wait(`${button("+ Sandbox Session")}`, "create trigger");
  await click(button("+ Sandbox Session"), "open create dialog");
  await wait(`document.querySelector('[role=dialog]')`, "dialog open");
  let s = await snap("01-dialog-first");
  check("dialog initially focuses Session ID", s.focus.name === "sessionId", s.focus);
  check("all dialog fields have labels", s.dialog.inputs.every((i) => i.labels === 1), s.dialog);
  await cdp("Input.insertText", { text: "cancelled-draft" });
  await click(button("Cancel"), "cancel dialog");
  await wait(`!document.querySelector('[role=dialog]')`, "cancel closes");
  s = await snap("02-cancelled");
  check("cancel restores create trigger focus", s.focus.text === "+ Sandbox Session", s.focus);
  await click(button("+ Sandbox Session"), "reopen create dialog");
  await wait(`document.querySelector('[role=dialog]')`, "reopen");
  s = await snap("03-dialog-reopen");
  check("cancelled draft is discarded on reopen", s.dialog.inputs.every((i) => i.value === ""), s.dialog);
  check("reopen focuses Session ID", s.focus.name === "sessionId", s.focus);
  await key("Tab", "Tab", 8);
  s = await snap("04-dialog-backtab");
  check("backward Tab remains in dialog", s.focus.text === "Create", s.focus);
  await key("Tab");
  await key("Escape");
  await wait(`!document.querySelector('[role=dialog]')`, "Escape close");
  check("cancel and Escape create no session", creates === 0, creates);
  await click(`[...document.querySelectorAll('a')].find(e=>e.textContent.trim()==='Open')`, "open existing synthetic session");
  await wait(`(${filesRoot})?.innerText.includes('documents')`, "root list");
  s = await snap("05-root");
  check("root shows actual fixture contents", s.fileText.includes("notes.txt"), s.fileText);
  const directoryControl = await ev(`(()=>{const e=${folder};const c=e?.closest('button,a,[role=button]');return c?{tag:c.tagName,tabIndex:c.tabIndex,disabled:c.disabled??false}:null;})()`);
  check("directory is an accessible keyboard control", !!directoryControl && directoryControl.tabIndex >= 0 && !directoryControl.disabled, directoryControl);
  if (directoryControl) {
    await ev(`(${filesRoot}).querySelector('button').focus()`);
    await key("Tab");
    const focused = await ev(`document.activeElement?.textContent.includes('documents')`);
    check("Tab reaches folder after file Refresh", focused, await snap("05-folder-focus"));
    await key("Enter");
    actions.push({ action: "enter documents", kind: "keyboard", at: Date.now() });
  } else await click(folder, "enter documents pointer fallback");
  await wait(`(${cwd})?.value==='./documents'&&(${filesRoot})?.innerText.includes('draft.md')`, "folder enter");
  s = await snap("06-folder");
  check("folder navigation completes", s.cwd === "./documents" && s.fileText.includes("draft.md"), s);
  const folderURL = s.url;
  actions.push({ action: "reload folder", kind: "browser", at: Date.now() });
  await cdp("Page.reload");
  await wait(`(${cwd})&& !(${filesRoot})?.innerText.includes('Loading')`, "reload listing");
  s = await snap("07-folder-reload");
  snapshots.reloadObservation = { beforeFolder: "./documents", beforeURL: folderURL, afterPath: s.cwd, afterURL: s.url, keptPath: s.cwd === "./documents" };
  await setPath("./documents");
  await wait(`(${filesRoot})?.innerText.includes('draft.md')`, "folder input");
  await setPath(".");
  await wait(`(${filesRoot})?.innerText.includes('notes.txt')`, "return root");
  s = await snap("08-return-root");
  check("explicit root return completes", s.cwd === "." && s.fileText.includes("notes.txt"), s);
  let history = await cdp("Page.getNavigationHistory");
  const current = history.currentIndex;
  check("session has real browser Back entry", current > 0, history.entries.map((x) => x.url));
  if (current > 0) {
    actions.push({ action: "browser Back", kind: "browser", at: Date.now() });
    await cdp("Page.navigateToHistoryEntry", { entryId: history.entries[current - 1].id });
    await wait(`${button("+ Sandbox Session")}`, "Back dashboard");
    await snap("09-back");
    actions.push({ action: "browser Forward", kind: "browser", at: Date.now() });
    await cdp("Page.navigateToHistoryEntry", { entryId: history.entries[current].id });
    await wait(`(${filesRoot})?.innerText.includes('notes.txt')`, "Forward session");
    s = await snap("10-forward");
    check("Back/Forward returns same session without create", s.url === "/gui/sandbox/synthetic" && creates === 0, s.url);
  }
  for (const errorMode of ["tool-error", "http-error"]) {
    mode = errorMode;
    await refresh();
    await wait(`document.querySelector('[role=alert]')`, "list error");
    s = await snap("11-" + errorMode);
    check(errorMode + " is visible failure not empty", s.alerts.length > 0 && !s.fileText.includes("Empty directory"), s);
    mode = "rows";
    await refresh();
    await wait(`(${filesRoot})?.innerText.includes('notes.txt')&&!document.querySelector('[role=alert]')`, "list recovery");
    s = await snap("12-" + errorMode + "-recovered");
    check(errorMode + " refresh restores rows", s.fileText.includes("documents") && s.alerts.length === 0, s);
  }
  mode = "held";
  await refresh();
  await wait(`(${filesRoot})?.innerText.includes('Loading')`, "loading visible");
  s = await snap("13-loading");
  check("pending list displays loading", s.fileText.includes("Loading"), s.fileText);
  for (let n = 0; n < 100 && !releaseList; n++) await delay(10);
  if (!releaseList) throw Error("held response was not received by fixture");
  mode = "rows";
  releaseList();
  releaseList = null;
  await wait(`(${filesRoot})?.innerText.includes('notes.txt')`, "held release");
  for (const invalid of ["malformed", "invalid-row", "bad-type"]) {
    mode = invalid;
    await refresh();
    await wait(`!(${filesRoot})?.innerText.includes('Loading')`, "invalid response settled");
    s = await snap("14-" + invalid);
    check(invalid + " list is not reported as a true empty directory", s.alerts.length > 0 && !s.fileText.includes("Empty directory"), s);
  }
  mode = "empty";
  await refresh();
  await wait(`(${filesRoot})?.innerText.includes('Empty directory')&&!document.querySelector('[role=alert]')`, "true empty");
  s = await snap("14-true-empty");
  check("true empty response remains distinct from failure", s.alerts.length === 0 && s.fileText.includes("Empty directory"), s);
  mode = "valid-kinds";
  await refresh();
  await wait(`(${filesRoot})?.innerText.includes('linked')`, "valid kinds");
  s = await snap("14-valid-kinds");
  check("symlink and unknown entries with nullable metadata remain valid", s.alerts.length === 0 && s.fileText.includes("unknown-kind"), s);
  mode = "rows";
  await refresh();
  await wait(`(${filesRoot})?.innerText.includes('notes.txt')`, "recover malformed");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  s = await snap("15-mobile-files");
  snapshots.mobileOverflowElements = await ev(`([...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,cls:e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width,text:e.textContent?.trim().slice(0,60)})).filter(e=>e.right>document.documentElement.clientWidth+1&&e.width>0).slice(0,15))`);
  check("file panel fits 390px without horizontal overflow", s.viewport.fileScroll <= s.viewport.fileClient + 1, s.viewport);
  snapshots.mobileDocumentOverflow = { width: s.viewport.width, scroll: s.viewport.bodyScroll, client: s.viewport.bodyClient, scope: "Whole page may include nonleased toolbar/shell; do not claim all page fixed from filepanel." };
  await click(`[...document.querySelectorAll('a')].find(e=>e.textContent.includes('Dashboard'))`, "back to dashboard");
  await wait(`${button("+ Sandbox Session")}`, "dashboard mobile");
  await click(button("+ Sandbox Session"), "open create mobile");
  await wait(`document.querySelector('[role=dialog]')`, "mobile dialog");
  s = await snap("16-mobile-dialog");
  check("create dialog fits 390px", s.viewport.bodyScroll <= s.viewport.bodyClient + 1, s.viewport);
  await key("Escape");
  await wait(`!document.querySelector('[role=dialog]')`, "mobile cancel");
  check("no accidental session creation across full flow", creates === 0, creates);
  check("no uncaught browser or fixture errors", errors.length === 0, errors);
  check("no external browser request forwarded", intercepted.every((x) => x.allowed), intercepted.filter((x) => !x.allowed));
  check("no shell/process authority or unexpected endpoint reached", requests.every((x) => !x.kind.startsWith("forbidden")), requests.filter((x) => x.kind.startsWith("forbidden")));
} catch (e) {
  fatal = e.stack ?? e.message;
} finally {
  releaseList?.();
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      await bounded(Promise.allSettled([...tasks]), "interceptors");
      if (process.env.COMPUTER_FLOW_FAULT === "websocket-close") {
        throw new Error("Intentional WebSocket cleanup fault");
      }
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
  if (profile) await bounded(rm(profile, { recursive: true, force: true }), "private profile removal").then(() => cleanup.profile = "removed").catch((e) => cleanup.profile = e.message);
}
check("owned WebSocket closed and awaited", cleanup.websocket === "closed", cleanup.websocket);
check("owned fixture closed", cleanup.fixture === "closed", cleanup.fixture);
check("owned Chrome exited", cleanup.chrome?.code === 0, cleanup.chrome);
check("private profile removed", cleanup.profile === "removed", cleanup.profile);
check("request interceptors completed without error", interceptorErrors.length === 0, interceptorErrors);
const failed = assertions.filter((x) => !x.passed);
const result = { status: fatal ? "HARNESS_ERROR" : failed.length ? "RED" : "PASS", scope: "Real publicmain dashboard build, synthetic loopback endpoint only; no real simulator host calls/account/provider/live", dashboardSha256: createHash("sha256").update(html).digest("hex"), browserVersion, fatal, assertions, failed: failed.map((x) => x.name), actions, actionCount: actions.length, actionCountDefinition: "semantic pointer/key/path/browser actions; bulk text entry is not a physical-keystroke count", creates, requests, intercepted, interceptorErrors, errors, snapshots, cleanup };
await writeFile(join(out, "REPORT.json"), JSON.stringify(result, null, 2) + "\n", { mode: 384 });
console.log(JSON.stringify({ status: result.status, failed: result.failed, fatal: result.fatal, actions: actions.length, creates, cleanup, report: join(out, "REPORT.json") }, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
