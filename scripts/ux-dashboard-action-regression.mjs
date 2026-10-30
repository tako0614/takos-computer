import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import { tmpdir } from "node:os";
const repo = resolve(process.env.COMPUTER_DASHBOARD_ACTION_REPO ?? resolve(import.meta.dirname, ".."));
const out = resolve(process.env.COMPUTER_DASHBOARD_ACTION_EVIDENCE ?? await mkdtemp(join(tmpdir(), "computer-dashboard-action-evidence-")));
await mkdir(out, { recursive: true, mode: 448 });
const harnessSha256 = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
const html = await readFile(join(repo, "packages/computer-hosts/src/gui/app.html"));
const requests = [], actions = [], assertions = [], errors = [], intercepted = [], interceptorErrors = [], snapshots = {};
const pending = /* @__PURE__ */ new Map(), tasks = /* @__PURE__ */ new Set();
const networkFinished = /* @__PURE__ */ new Set(), deleteNetwork = [], deliveredDeletes = [];
const destroyRequests = [], heldDestroys = [], dialogs = [];
const listRequests = [], heldLists = [], listNetwork = [], deliveredLists = [];
let holdNextList = false, nextListMode = "rows";
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
    if (req.method === "GET" && u.pathname === "/gui/api/sandbox-sessions") {
      const record = { kind: "session-list", sequence: listRequests.length, mode: nextListMode };
      listRequests.push(record); requests.push(record);
      res.writeHead(record.mode === "refusal" ? 503 : 200, { "content-type": "application/json", "cache-control": "no-store" });
      res.flushHeaders();
      if (holdNextList) {
        holdNextList = false;
        await new Promise((release) => heldLists.push({ record, release }));
      }
      return res.end(JSON.stringify(record.mode === "refusal" ? { error: "Synthetic list unavailable" } : { sessions: sessionIds.map((sessionId) => ({ ...session, sessionId })) }));
    }
    const id = sessionIds.find((id2) => u.pathname === "/gui/api/sandbox-session/" + id2);
    if (id && req.method === "GET") return send(res, 200, { ...session, sessionId: id });
    if (id && req.method === "DELETE") {
      const record = { kind: "intentional-synthetic-delete", sessionId: id, outcome: nextDestroyOutcome, sequence: destroyRequests.length, completed: false };
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
  profile = await mkdtemp(join(tmpdir(), "computer-dashboard-action-chrome-"));
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
      m.error ? p.no(Error(m.error.message)) : p.yes(m.result ?? {});
    } else if (m.method === "Network.requestWillBeSent") {
      if (m.params.request.method === "DELETE") deleteNetwork.push({ requestId: m.params.requestId, path: new URL(m.params.request.url).pathname });
      else if (m.params.request.method === "GET" && new URL(m.params.request.url).pathname === "/gui/api/sandbox-sessions") listNetwork.push({ requestId: m.params.requestId });
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
  if (process.env.COMPUTER_DASHBOARD_ACTION_FAULT === "missing-dom") {
    await navigate("/gui");
    await wait(`document.querySelector('[data-forced-missing-fixture]')`, "intentional missing DOM", 300);
  }
  // Drive the real built UI. Only the loopback fixture owns these no-op replies.
  const row = (id) => `[...document.querySelectorAll('tbody tr')].find(r=>r.querySelector('td')?.textContent.trim()===${JSON.stringify(id)})`;
  const remove = (id) => `(${row(id)})?.querySelector('button.btn-danger')`;
  const open = (id) => `(${row(id)})?.querySelector('a')`;
  const isPending = (id) => `(${remove(id)})?.getAttribute('aria-disabled')==='true'&&(${remove(id)})?.getAttribute('aria-busy')==='true'`;
  const refresh = `[...document.querySelectorAll('button')].find(e=>['Refresh sessions','一覧を更新'].includes(e.textContent.trim()))`;
  async function until(predicate, label) {
    const end = Date.now() + 3000;
    while (!predicate() && Date.now() < end) await delay(20);
    if (!predicate()) throw Error(label);
  }
  async function paint() {
    await ev("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  }
  async function beginDelete(id, outcome = "refusal") {
    nextDestroyOutcome = outcome; confirmAccept = true;
    const before = destroyRequests.length;
    await click(remove(id), "confirm no-op row deletion " + id + " " + outcome);
    await until(() => destroyRequests.length === before + 1, "original row DELETE not captured");
    return destroyRequests.at(-1);
  }
  async function releaseDelete(record) {
    const index = heldDestroys.findIndex((x) => x.record === record);
    if (index < 0) throw Error("missing selected held row response");
    heldDestroys.splice(index, 1)[0].release();
    await until(() => networkFinished.has(deleteNetwork[record.sequence]?.requestId), "selected row reply not observed by browser");
    deliveredDeletes.push({ ...deleteNetwork[record.sequence], sequence: record.sequence, loadingFinished: true });
    await paint();
  }
  async function releaseList() {
    await until(() => heldLists.length === 1, "one held list reply required");
    const x = heldLists.shift(); x.release();
    await until(() => networkFinished.has(listNetwork[x.record.sequence]?.requestId), "list reply not observed by browser");
    deliveredLists.push({ ...listNetwork[x.record.sequence], sequence: x.record.sequence, loadingFinished: true });
    await paint();
  }
  async function dashboard() {
    await click(`[...document.querySelectorAll('a')].find(e=>e.textContent.includes('Dashboard'))`, "return to a fresh Dashboard instance");
    await wait(remove("synthetic"), "current Dashboard rows");
  }
  async function leaveToB() {
    await click(open(otherSessionId), "leave Dashboard for B Viewer");
    await wait(`location.pathname.endsWith('/${otherSessionId}')&&document.body.innerText.includes('b-root.txt')`, "actual B Viewer");
  }
  await navigate("/gui"); await wait(remove("synthetic"), "actual row controls");
  confirmAccept = false;
  await click(remove("synthetic"), "cancel no-op row deletion");
  check("cancel preserves rows without DELETE", destroyRequests.length === 0 && await ev(`!!(${row("synthetic")})`), destroyRequests);
  const a = await beginDelete("synthetic");
  check("only pending A advertises disabled busy state with focus preserved", await ev(`(${isPending("synthetic")})&&!(${isPending(otherSessionId)})&&document.activeElement===(${remove("synthetic")})`), await snap("01-A-pending"));
  const confirmsBefore = dialogs.length;
  await key("Enter"); await delay(60);
  check("pending A repeated Enter is rejected before confirmation and DELETE", destroyRequests.length === 1 && dialogs.length === confirmsBefore, { destroyRequests, dialogs });
  const b = await beginDelete(otherSessionId);
  check("different B remains actionable while A is pending", a.sessionId === "synthetic" && b.sessionId === otherSessionId && await ev(`(${isPending("synthetic")})&&(${isPending(otherSessionId)})`), await snap("02-both-pending"));
  await releaseDelete(b);
  check("out-of-order B refusal does not clear A pending", await ev(`(${isPending("synthetic")})&&!(${isPending(otherSessionId)})&&[...document.querySelectorAll('[role=alert]')].some(e=>e.textContent.includes(${JSON.stringify(otherSessionId)}))`), await snap("03-B-refusal-A-pending"));
  await releaseDelete(a);
  let v = await snap("04-both-refused");
  check("both refusals report distinct original IDs as unconfirmed outcomes", v.alerts.length === 2 && sessionIds.every(id => v.alerts.some(text => text.includes("session " + id + ".") && text.includes("Could not confirm deletion"))), v.alerts);
  check("refusal retains both rows and current B action focus", await ev(`!!(${row("synthetic")})&&!!(${row(otherSessionId)})&&document.activeElement===(${remove(otherSessionId)})`), v);
  check("refusal is handled without unhandled exception", errors.length === 0, errors);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await click(button("日本語"), "localize row outcome feedback");
  v = await snap("05-mobile-refusal");
  check("390px Japanese unconfirmed feedback remains explicit within viewport", v.alerts.length === 2 && v.alerts.every(text => text.includes("削除結果を確認できません")) && v.viewport.bodyScroll <= v.viewport.bodyClient, v);
  await click(button("English"), "return row controls to English");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const countBeforeCancel = destroyRequests.length;
  confirmAccept = false; await click(remove("synthetic"), "cancel explicit retry");
  check("cancelled retry preserves original uncertainty without another request", destroyRequests.length === countBeforeCancel && await ev(`document.querySelectorAll('[role=alert]').length===2`), destroyRequests);
  const retry = await beginDelete("synthetic", "success");
  check("only explicit A retry clears A alert and preserves B alert", await ev(`document.querySelectorAll('[role=alert]').length===1&&document.querySelector('[role=alert]').textContent.includes(${JSON.stringify(otherSessionId)})`), await snap("06-A-retry"));
  holdNextList = true;
  const listCount = listRequests.length;
  await releaseDelete(retry);
  await until(() => heldLists.length === 1, "current ACK original list reload");
  check("current row ACK requests original list reload exactly once while retaining rows", listRequests.length === listCount + 1 && await ev(`!!(${open("synthetic")})&&!!(${open(otherSessionId)})&&!!document.querySelector('[role=status]')`), await snap("07-ACK-list-pending"));
  await key("Tab");
  check("keyboard can select B Open during row-triggered list refresh", await ev(`document.activeElement===(${open(otherSessionId)})`), await snap("08-B-open-pending"));
  await releaseList();
  check("row-triggered refresh retains PR21 original B Open focus", await ev(`document.activeElement===(${open(otherSessionId)})`), await snap("09-B-open-completed"));
  const lateRefusal = await beginDelete("synthetic");
  await leaveToB();
  const beforeLateRefusal = listRequests.length;
  await releaseDelete(lateRefusal);
  v = await snap("10-late-refusal-in-B");
  check("late row refusal cannot update Viewer or reload its old Dashboard", v.url.endsWith(otherSessionId) && v.fileText?.includes("b-root.txt") && v.alerts.length === 0 && listRequests.length === beforeLateRefusal && errors.length === 0, v);
  await dashboard();
  const lateACK = await beginDelete("synthetic", "success");
  await leaveToB(); await dashboard();
  const current = await beginDelete("synthetic");
  const beforeLateACK = listRequests.length;
  await releaseDelete(lateACK);
  check("late old-instance ACK cannot clear new same-ID pending or reload new Dashboard", listRequests.length === beforeLateACK && await ev(`(${isPending("synthetic")})&&document.querySelectorAll('[role=alert]').length===0`), await snap("11-old-ACK-new-A-pending"));
  await releaseDelete(current);
  check("new same-ID refusal still settles its own pending and uncertainty", await ev(`!(${isPending("synthetic")})&&document.querySelectorAll('[role=alert]').length===1&&document.querySelector('[role=alert]').textContent.includes('session synthetic.')`), await snap("12-new-A-refusal"));
  check("all no-op row replies were observed by browser exactly once", deliveredDeletes.length === destroyRequests.length && new Set(deliveredDeletes.map(x => x.sequence)).size === destroyRequests.length, deliveredDeletes);
  check("no session is created", creates === 0, creates);
  check("no uncaught page errors", errors.length === 0, errors);
  check("only synthetic endpoints are reached", requests.every(x => !x.kind.startsWith("forbidden")), requests.filter(x => x.kind.startsWith("forbidden")));
  check("no external request is forwarded", intercepted.every(x => x.allowed), intercepted.filter(x => !x.allowed));
} catch (e) {
  fatal = e.stack ?? e.message;
} finally {
  for (const x of [...heldDestroys.splice(0), ...heldLists.splice(0)]) x.release();
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      await bounded(Promise.allSettled([...tasks]), "interceptors");
      if (process.env.COMPUTER_DASHBOARD_ACTION_FAULT === "websocket-close") {
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
  if (profile) await bounded(rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }), "private profile removal").then(() => cleanup.profile = "removed").catch((e) => cleanup.profile = e.message);
}
check("owned WebSocket closed and awaited", cleanup.websocket === "closed", cleanup.websocket);
check("owned fixture closed", cleanup.fixture === "closed", cleanup.fixture);
check("owned Chrome exited", cleanup.chrome?.code === 0, cleanup.chrome);
check("private profile removed", cleanup.profile === "removed", cleanup.profile);
check("request interceptors completed without error", interceptorErrors.length === 0, interceptorErrors);
const failed = assertions.filter((x) => !x.passed);
const result = { status: fatal ? "HARNESS_ERROR" : failed.length ? "RED" : "PASS", harnessSha256, scope: "Actual built UI row action pending/refusal/lifetime and PR21 compatibility; strict no-op synthetic DELETE, no native host/lifecycle/provider/auth/live", dashboardSha256: createHash("sha256").update(html).digest("hex"), browserVersion, chromeStderr, fatal, assertions, failed: failed.map((x) => x.name), actions, actionCount: actions.length, actionCountDefinition: "semantic pointer/key/path/browser actions; bulk text entry is not a physical-keystroke count", creates, destroyRequests, deliveredDeletes, listRequests, deliveredLists, dialogs, requests, intercepted, interceptorErrors, errors, snapshots, cleanup };
await writeFile(join(out, "REPORT.json"), JSON.stringify(result, null, 2) + "\n", { mode: 384 });
console.log(JSON.stringify({ status: result.status, failed: result.failed, fatal: result.fatal, actions: actions.length, creates, cleanup, report: join(out, "REPORT.json") }, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
