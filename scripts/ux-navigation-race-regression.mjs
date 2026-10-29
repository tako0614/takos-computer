import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join, posix } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import { tmpdir } from "node:os";
const repo = resolve(process.env.COMPUTER_NAV_REPO ?? resolve(import.meta.dirname, ".."));
const out = resolve(process.env.COMPUTER_NAV_EVIDENCE ?? await mkdtemp(join(tmpdir(), "computer-navigation-evidence-")));
await mkdir(out, { recursive: true, mode: 448 });
const harnessSha256 = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
const html = await readFile(join(repo, "packages/computer-hosts/src/gui/app.html"));
const requests = [], actions = [], assertions = [], errors = [], intercepted = [], interceptorErrors = [], snapshots = {};
const pending = /* @__PURE__ */ new Map(), tasks = /* @__PURE__ */ new Set();
let nextId = 1, ws, chrome, chromeExit, profile, fixturePort, debugPort, fatal = null, mode = "rows", releaseList = null;
let nextHeldOutcome = "rows", holdStatusId = null, releaseStatus = null;
let chromeStderr = "";
let creates = 0, cleanup = {}, browserVersion, workspaceRoot = "/home/sandbox/workspace";
const entry = (name, type = "file") => ({ name, type, size: 24, modified: "2026-01-01T00:00:00.000Z" });
const longName = "long-directory-name-".repeat(9);
const otherSessionId = "synthetic-session-with-a-long-identifier-1234567890";
const sessionIds = ["synthetic", otherSessionId];
const session = { sessionId: "synthetic", spaceId: "fixture", userId: "fixture", status: "active", createdAt: "2026-01-01T00:00:00.000Z" };
const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && ["/gui", "/gui/", ...sessionIds.map((id) => "/gui/sandbox/" + id)].includes(u.pathname)) {
      requests.push({ kind: "dashboard", method: req.method, path: u.pathname });
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      return res.end(html);
    }
    if (req.method === "GET" && ["/gui/manifest.webmanifest", "/gui/icons/icon-192.png", "/gui/icons/icon-512.png", "/gui/icons/icon-maskable-512.png", "/gui/icons/apple-touch-icon.png"].includes(u.pathname)) {
      const resource = await readFile(join(repo, "packages/dashboard/public", u.pathname.slice(5)));
      res.writeHead(200, { "content-type": u.pathname.endsWith(".png") ? "image/png" : "application/manifest+json" });
      return res.end(resource);
    }
    if (req.method === "GET" && u.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "GET" && u.pathname === "/gui/api/sandbox-sessions") {
      requests.push({ kind: "session-list" });
      return send(res, 200, { sessions: [session] });
    }
    if (req.method === "GET" && sessionIds.some((id) => u.pathname === "/gui/api/sandbox-session/" + id)) {
      const selectedId = sessionIds.find((id) => u.pathname.endsWith("/" + id));
      requests.push({ kind: "session-status", sessionId: selectedId });
      if (holdStatusId === selectedId) {
        holdStatusId = null;
        await new Promise((resolve2) => {
          releaseStatus = resolve2;
        });
      }
      requests.push({ kind: "status-completed", sessionId: selectedId });
      return send(res, 200, { ...session, sessionId: selectedId, status: selectedId === otherSessionId ? "stopped" : "active" });
    }
    if (req.method === "POST" && u.pathname === "/gui/api/sandbox-create") {
      creates++;
      requests.push({ kind: "forbidden-create" });
      return send(res, 403, { error: "fixture never creates sessions" });
    }
    if (req.method === "POST" && sessionIds.some((id) => u.pathname === "/gui/api/sandbox-session/" + id + "/mcp")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const call = JSON.parse(raw), tool = call.params?.name, path = call.params?.arguments?.path;
      const calledSession = sessionIds.find((id) => u.pathname === "/gui/api/sandbox-session/" + id + "/mcp");
      requests.push({ kind: "synthetic-tool", sessionId: calledSession, tool, path, mode });
      let result2;
      if (tool === "process_list") result2 = { content: [{ type: "text", text: '{"processes":[]}' }] };
      else if (tool !== "file_list") {
        requests.push({ kind: "forbidden-tool", tool });
        return send(res, 403, { error: "only synthetic file_list/process_list allowed" });
      } else {
        const initialMode = mode;
        const selectedMode = initialMode === "held" ? nextHeldOutcome : initialMode;
        if (initialMode === "held") await new Promise((resolve2) => {
          releaseList = resolve2;
        });
        if (selectedMode === "http-error") return send(res, 503, { error: "Synthetic directory service unavailable" });
        if (selectedMode === "tool-error") result2 = { isError: true, content: [{ type: "text", text: "Synthetic directory listing refused" }] };
        else {
          let body;
          const relativePath = typeof path === "string" ? posix.relative(workspaceRoot, posix.resolve(workspaceRoot, path)) : "..";
          if (relativePath === ".." || relativePath.startsWith("../")) return send(res, 200, { jsonrpc: "2.0", id: call.id, result: { isError: true, content: [{ type: "text", text: "Synthetic outside workspace refusal" }] } });
          const listedPath = relativePath ? "./" + relativePath : ".";
          if (selectedMode === "malformed") body = {};
          else if (selectedMode === "invalid-row") body = { entries: [null] };
          else if (selectedMode === "bad-type") body = { entries: [{ ...entry("bad"), type: ["file"] }] };
          else if (selectedMode === "valid-kinds") body = { entries: [entry("linked", "symlink"), { ...entry("unknown-kind", "unknown"), modified: null }] };
          else if (selectedMode === "empty") body = { entries: [] };
          else if (listedPath === ".") body = { entries: [entry("documents", "directory"), entry(longName, "directory"), entry(calledSession === otherSessionId ? "other-notes.txt" : "notes.txt")] };
          else if (listedPath === "./documents") body = { entries: [entry("draft.md"), entry("archive", "directory")] };
          else if (listedPath === "./documents/archive") body = { entries: [entry("retained.txt")] };
          else return send(res, 200, { jsonrpc: "2.0", id: call.id, result: { isError: true, content: [{ type: "text", text: "Synthetic outside workspace refusal" }] } });
          result2 = { content: [{ type: "text", text: JSON.stringify(body) }] };
        }
      }
      requests.push({ kind: "synthetic-completed", tool, sessionId: calledSession, path });
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
  await click(`[...(${filesRoot})?.querySelectorAll('button')].find(e=>e.textContent.trim()==='Refresh')`, "file Refresh");
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
  profile = await mkdtemp(join(tmpdir(), "computer-navigation-chrome-"));
  chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  chrome.stderr.on("data", chunk => { if(chromeStderr.length < 65536) chromeStderr += chunk.toString(); });
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
  if (process.env.COMPUTER_NAV_FAULT === "missing-dom") {
    await navigate("/gui");
    await wait(`document.querySelector('[data-forced-missing-fixture]')`, "intentional missing DOM", 300);
  }
  const rootReady = `(${filesRoot})?.innerText.includes('notes.txt') && !(${filesRoot})?.innerText.includes('Loading')`;
  const completeCount = () => requests.filter((x) => x.kind === "synthetic-completed" && x.tool === "file_list").length;
  async function holdPath(path, outcome = "rows") {
    mode = "held";
    nextHeldOutcome = outcome;
    await setPath(path);
    const end = Date.now() + 3e3;
    while (!releaseList && Date.now() < end) await delay(20);
    if (!releaseList) throw Error("held request not captured");
    mode = "rows";
  }
  async function releaseHeld() {
    const release = releaseList;
    if (!release) throw Error("missing held response");
    releaseList = null;
    const before = completeCount();
    release();
    const end = Date.now() + 3e3;
    while (completeCount() <= before && Date.now() < end) await delay(20);
    if (completeCount() <= before) throw Error("held response did not complete");
    await cdp("Runtime.evaluate", { expression: "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))", awaitPromise: true });
  }
  async function routerLink(id, label) {
    await ev(`(()=>{const old=document.getElementById('race-route');old?.remove();const a=document.createElement('a');a.id='race-route';a.href='/gui/sandbox/${id}';a.textContent='Synthetic route';document.body.append(a)})()`);
    await click(`document.getElementById('race-route')`, label);
    await wait(`location.pathname.endsWith('${id}')`, label + " route");
  }
  await navigate("/gui");
  await wait(`[...document.querySelectorAll('a')].some(e=>e.textContent.trim()==='Open')`, "session list ready");
  await click(`[...document.querySelectorAll('a')].find(e=>e.textContent.trim()==='Open')`, "open A");
  await wait(rootReady, "A root");
  await holdPath("./documents");
  await setPath("./documents/archive");
  await wait(`(${filesRoot})?.innerText.includes('retained.txt')`, "new folder wins");
  await releaseHeld();
  let v = await snap("01-old-success-after-new-success");
  check("late old folder success cannot replace latest folder rows", v.cwd === "./documents/archive" && v.fileText.includes("retained.txt") && !v.fileText.includes("draft.md"), v);
  await holdPath("./documents", "tool-error");
  await setPath(".");
  await wait(rootReady, "root recovers before old error");
  await releaseHeld();
  v = await snap("02-old-error-after-root");
  check("late old failure cannot replace latest success with error", v.cwd === "." && v.alerts.length === 0 && v.fileText.includes("notes.txt"), v);
  await holdPath("./documents");
  await routerLink(otherSessionId, "immediate switch to B while A list held");
  await wait(`(${cwd})?.value==='.'&&(${filesRoot})?.innerText.includes('other-notes.txt')`, "B owns rows");
  await releaseHeld();
  v = await snap("03-held-A-after-B");
  check("A late response never renders its rows in B", v.cwd === "." && v.fileText.includes("other-notes.txt") && !v.fileText.includes("draft.md"), v);
  const badge = await ev(`document.querySelector('.badge')?.textContent.trim()`);
  check("toolbar status is fetched for the selected session", badge === "stopped" && requests.some((x) => x.kind === "session-status" && x.sessionId === otherSessionId), { badge, statusReads: requests.filter((x) => x.kind === "session-status") });
  check("immediate route switch stores no A directory under B", await ev(`!history.state?.takosComputerDirectory || (history.state.takosComputerDirectory.sessionId==='${otherSessionId}'&&history.state.takosComputerDirectory.cwd==='.')`), await ev("history.state"));
  await routerLink("synthetic", "return A");
  await wait(`(${cwd})?.value==='.'&&${rootReady}`, "A default");
  await holdPath("./documents");
  await click(`[...document.querySelectorAll('a')].find(e=>e.textContent.includes('Dashboard'))`, "leave while directory request pending");
  await wait(`${button("+ Sandbox Session")}`, "dashboard pending exit");
  await releaseHeld();
  const nav = await cdp("Page.getNavigationHistory");
  const back = nav.entries[nav.currentIndex - 1];
  check("pending directory update keeps a browser Back entry for session", !!back && new URL(back.url).pathname === "/gui/sandbox/synthetic", nav.entries.map((e) => e.url));
  if (back && new URL(back.url).pathname === "/gui/sandbox/synthetic") {
    await cdp("Page.navigateToHistoryEntry", { entryId: back.id });
    await wait(`(${cwd})&&!(${filesRoot})?.innerText.includes('Loading')`, "Back pending directory");
    v = await snap("04-back-after-pending-exit");
    check("Back restores intended directory after pending exit", v.cwd === "./documents" && v.fileText.includes("draft.md"), v);
  }
  holdStatusId = "synthetic";
  await navigate("/gui/sandbox/synthetic?held-status=1");
  await snap("05-status-held-initial");
  await wait(rootReady, "A root while status held");
  const deadline = Date.now() + 3e3;
  while (!releaseStatus && Date.now() < deadline) await delay(20);
  if (!releaseStatus) throw Error("A status hold missing");
  await routerLink(otherSessionId, "B while A status held");
  await wait(`(${filesRoot})?.innerText.includes('other-notes.txt')&&document.querySelector('.badge')?.textContent.trim()==='stopped'`, "B independent status");
  const finishBefore = requests.filter((x) => x.kind === "status-completed" && x.sessionId === "synthetic").length;
  releaseStatus();
  releaseStatus = null;
  const finishDeadline = Date.now() + 3e3;
  while (requests.filter((x) => x.kind === "status-completed" && x.sessionId === "synthetic").length === finishBefore && Date.now() < finishDeadline) await delay(20);
  if (requests.filter((x) => x.kind === "status-completed" && x.sessionId === "synthetic").length === finishBefore) throw Error("A held status did not finish");
  await cdp("Runtime.evaluate", { expression: "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))", awaitPromise: true });
  check("late A status cannot replace selected B status", await ev(`document.querySelector('.badge')?.textContent.trim()==='stopped'`), await snap("05-late-A-status"));
  check("no accidental session creation", creates === 0, creates);
  check("no uncaught page errors", errors.length === 0, errors);
  check("only synthetic allowed endpoints reached", requests.every((x) => !x.kind.startsWith("forbidden")), requests.filter((x) => x.kind.startsWith("forbidden")));
  check("no external page request forwarded", intercepted.every((x) => x.allowed), intercepted.filter((x) => !x.allowed));
} catch (e) {
  fatal = e.stack ?? e.message;
} finally {
  releaseList?.();
  releaseStatus?.();
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      await bounded(Promise.allSettled([...tasks]), "interceptors");
      if (process.env.COMPUTER_NAV_FAULT === "websocket-close") {
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
const result = { status: fatal ? "HARNESS_ERROR" : failed.length ? "RED" : "PASS", harnessSha256, scope: "Real publicmain dashboard build, synthetic loopback endpoint only; no real simulator host calls/account/provider/live", dashboardSha256: createHash("sha256").update(html).digest("hex"), browserVersion, chromeStderr, fatal, assertions, failed: failed.map((x) => x.name), actions, actionCount: actions.length, actionCountDefinition: "semantic pointer/key/path/browser actions; bulk text entry is not a physical-keystroke count", creates, requests, intercepted, interceptorErrors, errors, snapshots, cleanup };
await writeFile(join(out, "REPORT.json"), JSON.stringify(result, null, 2) + "\n", { mode: 384 });
console.log(JSON.stringify({ status: result.status, failed: result.failed, fatal: result.fatal, actions: actions.length, creates, cleanup, report: join(out, "REPORT.json") }, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
