import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import { tmpdir } from "node:os";
const repo = resolve(process.env.COMPUTER_VIEWER_ACTION_REPO ?? resolve(import.meta.dirname, ".."));
const out = resolve(process.env.COMPUTER_VIEWER_ACTION_EVIDENCE ?? await mkdtemp(join(tmpdir(), "computer-viewer-action-evidence-")));
await mkdir(out, { recursive: true, mode: 448 });
const harnessSha256 = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
const html = await readFile(join(repo, "packages/computer-hosts/src/gui/app.html"));
const requests = [], actions = [], assertions = [], errors = [], intercepted = [], interceptorErrors = [], snapshots = {};
const pending = /* @__PURE__ */ new Map(), tasks = /* @__PURE__ */ new Set();
const networkFinished = /* @__PURE__ */ new Set(), deleteNetwork = [], deliveredDeletes = [];
const destroyRequests = [], heldDestroys = [], dialogs = [];
let nextId = 1, ws, chrome, chromeExit, profile, fixturePort, debugPort, fatal = null;
let chromeStderr = "", confirmAccept = false, nextDestroyOutcome = "refusal";
let creates = 0, cleanup = {}, browserVersion;
const entry = (name, type = "file") => ({ name, type, size: 24, modified: "2026-01-01T00:00:00.000Z" });
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
    if (req.method === "GET" && ["/gui", "/gui/", ...sessionIds.map((id2) => "/gui/sandbox/" + id2)].includes(u.pathname)) {
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
    if (req.method === "GET" && u.pathname === "/gui/api/sandbox-sessions") return send(res, 200, { sessions: sessionIds.map((sessionId) => ({ ...session, sessionId })) });
    const id = sessionIds.find((id2) => u.pathname === "/gui/api/sandbox-session/" + id2);
    if (id && req.method === "GET") return send(res, 200, { ...session, sessionId: id });
    if (id && req.method === "DELETE") {
      const record = { kind: "intentional-synthetic-delete", sessionId: id, outcome: nextDestroyOutcome, completed: false };
      destroyRequests.push(record);
      requests.push(record);
      await new Promise((done) => heldDestroys.push({ record, release: done }));
      record.completed = true;
      return record.outcome === "success" ? send(res, 200, { ok: true }) : send(res, 503, { error: "Synthetic destruction unavailable" });
    }
    const mcpId = sessionIds.find((id2) => u.pathname === "/gui/api/sandbox-session/" + id2 + "/mcp");
    if (mcpId && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const call = JSON.parse(raw), tool = call.params?.name;
      if (!["file_list", "process_list"].includes(tool)) {
        requests.push({ kind: "forbidden-tool", tool });
        return send(res, 403, { error: "No host tool calls" });
      }
      requests.push({ kind: "synthetic-tool", tool, sessionId: mcpId });
      const body = tool === "process_list" ? { processes: [] } : { entries: [entry(mcpId === otherSessionId ? "b-root.txt" : "a-root.txt")] };
      return send(res, 200, { jsonrpc: "2.0", id: call.id, result: { content: [{ type: "text", text: JSON.stringify(body) }] } });
    }
    if (req.method === "POST" && u.pathname === "/gui/api/sandbox-create") creates++;
    requests.push({ kind: "forbidden-route", method: req.method, path: u.pathname });
    return send(res, 403, { error: "Synthetic fixture only; no native lifecycle handler" });
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
const filesRoot = `[...document.querySelectorAll('span')].find(e=>e.textContent.trim()==='Files')?.parentElement?.parentElement`;
const cwd = `document.querySelector('input.input-mono')`;
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
  profile = await mkdtemp(join(tmpdir(), "computer-viewer-action-chrome-"));
  chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
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
    } else if (m.method === "Network.requestWillBeSent") {
      if (m.params.request.method === "DELETE") deleteNetwork.push({ requestId: m.params.requestId, path: new URL(m.params.request.url).pathname });
    } else if (m.method === "Network.loadingFinished") networkFinished.add(m.params.requestId);
    else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === "Page.javascriptDialogOpening") {
      const accept = m.params.type === "confirm" ? confirmAccept : true;
      dialogs.push({ type: m.params.type, message: m.params.message, accepted: accept });
      actions.push({ action: "answer synthetic lifecycle confirmation", kind: "native-confirm", accepted: accept, at: Date.now() });
      if (m.params.type !== "confirm") errors.push("unexpected native dialog " + m.params.type);
      const task = cdp("Page.handleJavaScriptDialog", { accept }).catch((e) => interceptorErrors.push(e.message)).finally(() => tasks.delete(task));
      tasks.add(task);
    } else if (m.method === "Fetch.requestPaused") {
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
  if (process.env.COMPUTER_VIEWER_ACTION_FAULT === "missing-dom") {
    await navigate("/gui");
    await wait(`document.querySelector('[data-forced-missing-fixture]')`, "intentional missing DOM", 300);
  }
  const destroyButton = `document.querySelector('button.btn-danger')`;
  async function openSession(id) {
    await wait(`[...document.querySelectorAll('tr')].some(r=>r.textContent.includes('${id}'))`, "listed session");
    await click(`[...document.querySelectorAll('tr')].find(r=>r.textContent.includes('${id}'))?.querySelector('a')`, "open " + id);
    await wait(`(${filesRoot})?.innerText.includes('${id === otherSessionId ? "b-root.txt" : "a-root.txt"}')`, "selected session UI");
  }
  async function dashboard() {
    await click(`[...document.querySelectorAll('a')].find(e=>e.textContent.includes('Dashboard'))`, "leave pending session");
    await wait(`${button("+ Sandbox Session")}`, "Dashboard");
  }
  async function startDestroy(outcome) {
    nextDestroyOutcome = outcome;
    confirmAccept = true;
    const before = destroyRequests.length;
    await click(destroyButton, "confirm synthetic destruction " + outcome);
    const end = Date.now() + 3e3;
    while (destroyRequests.length === before && Date.now() < end) await delay(20);
    if (destroyRequests.length === before) throw Error("synthetic delete not captured");
  }
  async function releaseDestroys() {
    const batch = heldDestroys.splice(0), expected = destroyRequests.length;
    if (!batch.length) throw Error("missing held lifecycle response");
    for (const x of batch) x.release();
    const end = Date.now() + 3e3;
    while ((deleteNetwork.length < expected || deleteNetwork.slice(0, expected).some((x) => !networkFinished.has(x.requestId))) && Date.now() < end) await delay(20);
    if (deleteNetwork.length < expected || deleteNetwork.slice(0, expected).some((x) => !networkFinished.has(x.requestId))) throw Error("lifecycle response not received by browser");
    for (const x of deleteNetwork.slice(deliveredDeletes.length, expected)) deliveredDeletes.push({ ...x, loadingFinished: true });
    await cdp("Runtime.evaluate", { expression: "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))", awaitPromise: true });
    await delay(80);
  }
  await navigate("/gui");
  await openSession("synthetic");
  confirmAccept = false;
  await click(destroyButton, "cancel synthetic destruction");
  let v = await snap("01-cancelled");
  check("canceling confirmation sends no lifecycle request", destroyRequests.length === 0 && v.url === "/gui/sandbox/synthetic", { requests: destroyRequests, view: v });
  await startDestroy("refusal");
  v = await snap("02-pending");
  check("pending lifecycle action is visibly busy and locally reentry-guarded", await ev(`(${destroyButton})?.getAttribute('aria-disabled')==='true'&&(${destroyButton})?.getAttribute('aria-busy')==='true'`), v);
  await key("Enter");
  await delay(60);
  check("repeated Enter during pending action sends no second DELETE", destroyRequests.length === 1, { requests: destroyRequests, dialogs });
  await releaseDestroys();
  v = await snap("03-refused");
  check("refusal is caught and reported as unconfirmed outcome in the same view", v.url === "/gui/sandbox/synthetic" && v.alerts.some((x) => x.includes("Could not confirm destruction")), v);
  check("refusal preserves the selected files and explicit recovery controls", v.fileText.includes("a-root.txt") && await ev(`(${destroyButton})?.getAttribute('aria-disabled')!=='true'&&!!${button("Refresh status")}`), v);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  v = await snap("03-refusal-mobile");
  check("390px unconfirmed feedback and focused action remain usable", v.viewport.bodyScroll <= v.viewport.bodyClient && v.alerts.some((x) => x.includes("Could not confirm destruction")) && await ev(`document.activeElement===(${destroyButton})`), v);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const errorsAfterRefusal = [...errors];
  check("refused lifecycle request creates no unhandled exception", errorsAfterRefusal.length === 0, errorsAfterRefusal);
  await startDestroy("refusal");
  await dashboard();
  await openSession(otherSessionId);
  await releaseDestroys();
  v = await snap("04-late-refusal-in-B");
  check("late A refusal never changes B selection or introduces an error", v.url.endsWith(otherSessionId) && v.fileText.includes("b-root.txt") && !v.alerts.length, v);
  check("late A refusal is handled after its view unmounts", errors.length === 0, errors);
  await dashboard();
  await openSession("synthetic");
  await startDestroy("success");
  await dashboard();
  await openSession(otherSessionId);
  await releaseDestroys();
  v = await snap("05-late-success-in-B");
  check("late A acknowledgement cannot redirect away from selected B", v.url.endsWith(otherSessionId) && v.fileText?.includes("b-root.txt"), v);
  check("all intended lifecycle responses reached the browser", deliveredDeletes.length === destroyRequests.length && deliveredDeletes.every((x) => x.loadingFinished), deliveredDeletes);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  v = await snap("06-mobile");
  check("390px action feedback stays within the viewport", v.viewport.bodyScroll <= v.viewport.bodyClient, v.viewport);
  await dashboard();
  await openSession("synthetic");
  await startDestroy("success");
  await releaseDestroys();
  await wait(`location.pathname==='/gui'&&!!${button("+ Sandbox Session")}`, "current acknowledgement returns Dashboard");
  check("acknowledgement for the still-selected original session preserves original Dashboard navigation", await ev(`location.pathname==='/gui'&&!!${button("+ Sandbox Session")}`), await snap("07-current-acknowledgement"));
  check("fixture never creates sessions", creates === 0, creates);
  check("no uncaught page errors", errors.length === 0, errors);
  check("only strict synthetic endpoints reached", requests.every((x) => !x.kind.startsWith("forbidden")), requests.filter((x) => x.kind.startsWith("forbidden")));
  check("no external page request forwarded", intercepted.every((x) => x.allowed), intercepted.filter((x) => !x.allowed));
} catch (e) {
  fatal = e.stack ?? e.message;
} finally {
  for (const x of heldDestroys.splice(0)) x.release();
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      await bounded(Promise.allSettled([...tasks]), "interceptors");
      if (process.env.COMPUTER_VIEWER_ACTION_FAULT === "websocket-close") {
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
const result = { status: fatal ? "HARNESS_ERROR" : failed.length ? "RED" : "PASS", harnessSha256, scope: "Actual builtUI lifecycle-action callbacks only; strict no-op synthetic DELETE response, no native session/host operation/account/provider/live", dashboardSha256: createHash("sha256").update(html).digest("hex"), browserVersion, chromeStderr, fatal, assertions, failed: failed.map((x) => x.name), actions, actionCount: actions.length, actionCountDefinition: "semantic pointer/key/path/browser actions; bulk text entry is not a physical-keystroke count", creates, destroyRequests, deliveredDeletes, dialogs, requests, intercepted, interceptorErrors, errors, snapshots, cleanup };
await writeFile(join(out, "REPORT.json"), JSON.stringify(result, null, 2) + "\n", { mode: 384 });
console.log(JSON.stringify({ status: result.status, failed: result.failed, fatal: result.fatal, actions: actions.length, creates, cleanup, report: join(out, "REPORT.json") }, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
