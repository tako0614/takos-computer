import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import { tmpdir } from "node:os";
const repo = resolve(process.env.COMPUTER_STATUS_REPO ?? resolve(import.meta.dirname, ".."));
const out = resolve(process.env.COMPUTER_STATUS_EVIDENCE ?? await mkdtemp(join(tmpdir(), "computer-status-evidence-")));
await mkdir(out, { recursive: true, mode: 448 });
const harnessSha256 = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
const html = await readFile(join(repo, "packages/computer-hosts/src/gui/app.html"));
const requests = [], actions = [], assertions = [], errors = [], intercepted = [], interceptorErrors = [], snapshots = {};
const pending = /* @__PURE__ */ new Map(), tasks = /* @__PURE__ */ new Set();
let nextId = 1, ws, chrome, chromeExit, profile, fixturePort, debugPort, fatal = null;
let holdStatusId = null, releaseStatus = null, statusMode = "http-error";
let chromeStderr = "";
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
      const outcome = statusMode;
      requests.push({ kind: "session-status", sessionId: selectedId, outcome });
      if (holdStatusId === selectedId) {
        holdStatusId = null;
        await new Promise((resolve2) => {
          releaseStatus = resolve2;
        });
      }
      requests.push({ kind: "status-completed", sessionId: selectedId, outcome });
      if (outcome === "http-error") return send(res, 503, { error: "Synthetic status service unavailable" });
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
      requests.push({ kind: "synthetic-tool", sessionId: calledSession, tool, path });
      let result2;
      if (tool === "process_list") result2 = { content: [{ type: "text", text: '{"processes":[]}' }] };
      else if (tool === "file_list" && [".", "./documents"].includes(path)) {
        const entries = path === "./documents" ? [entry("draft.md")] : [entry("documents", "directory"), entry(calledSession === otherSessionId ? "other-notes.txt" : "notes.txt")];
        result2 = { content: [{ type: "text", text: JSON.stringify({ entries }) }] };
      } else {
        requests.push({ kind: "forbidden-tool", tool });
        return send(res, 403, { error: "only synthetic file_list/process_list allowed" });
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
  profile = await mkdtemp(join(tmpdir(), "computer-status-chrome-"));
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
  if (process.env.COMPUTER_STATUS_FAULT === "missing-dom") {
    await navigate("/gui");
    await wait(`document.querySelector('[data-forced-missing-fixture]')`, "intentional missing DOM", 300);
  }
  const rootReady = `(${filesRoot})?.innerText.includes('notes.txt') && !(${filesRoot})?.innerText.includes('Loading')`;
  const badge = `document.querySelector('.badge')`;
  const statusButton = `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Refresh status')`;
  const statusCount = () => requests.filter(x => x.kind === 'session-status').length;
  const completedCount = () => requests.filter(x => x.kind === 'status-completed').length;
  const paint = () => ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  async function settledAfter(before) {
    const deadline = Date.now() + 3000;
    while (completedCount() <= before && Date.now() < deadline) await delay(20);
    if (completedCount() <= before) throw Error('status response not completed');
    await paint();
  }
  async function retryByKeyboard(buttonExpression = statusButton) {
    const before = completedCount();
    await ev(`(${buttonExpression}).focus()`);
    await key('Enter');
    await settledAfter(before);
  }
  await navigate('/gui/sandbox/synthetic');
  await wait(rootReady, 'files usable despite status failure');
  await settledAfter(0);
  let v = await snap('01-status-http503');
  check('completed status503 is unavailable, not loading or stopped', await ev(`${badge}?.textContent.trim()==='Status unavailable' && !${badge}?.classList.contains('badge-stopped')`), v);
  check('status failure has an explicit keyboard-accessible refresh', await ev(`!!(${statusButton}) && (${statusButton}).type==='button' && (${statusButton}).getAttribute('aria-disabled')!=='true'`), v);
  check('failed status does not block usable file rows', v.fileText.includes('notes.txt'), v.fileText);
  await click(folder, 'open documents while status unavailable');
  await wait(`(${cwd})?.value==='./documents'&&(${filesRoot})?.innerText.includes('draft.md')`, 'directory stays usable');
  statusMode = 'rows';
  holdStatusId = 'synthetic';
  await ev(`(${statusButton}).focus()`);
  const beforeRetry = completedCount(), readsBefore = statusCount();
  await key('Enter');
  const heldDeadline = Date.now() + 3000;
  while (!releaseStatus && Date.now() < heldDeadline) await delay(20);
  if (!releaseStatus) throw Error('retry hold missing');
  v = await snap('02-retry-pending');
  check('in-flight retry shows loading instead of a completed error', await ev(`${badge}?.textContent.trim()==='loading'`), v);
  check('refresh is disabled during its in-flight GET', await ev(`(${statusButton})?.getAttribute('aria-disabled')==='true'`), v);
  await key('Enter');
  await paint();
  check('repeated keyboard activation does not duplicate the pending GET', statusCount() === readsBefore + 1, requests.filter(x=>x.kind==='session-status'));
  releaseStatus(); releaseStatus = null;
  await settledAfter(beforeRetry);
  await wait(`${badge}?.textContent.trim()==='active'`, 'successful retry');
  v = await snap('03-keyboard-recovered');
  check('one keyboard retry recovers status without changing cwd', v.cwd==='./documents' && v.fileText.includes('draft.md') && await ev(`${badge}?.classList.contains('badge-active')`), v);
  check('status retry keeps keyboard focus after completion', await ev(`document.activeElement===(${statusButton})`), v.focus);
  // Observe the original real 10s poll, not a synthetic replacement timer.
  statusMode = 'http-error';
  const beforePoll = completedCount();
  const pollDeadline = Date.now() + 12000;
  while (completedCount() <= beforePoll && Date.now() < pollDeadline) await delay(50);
  if (completedCount() <= beforePoll) throw Error('original status poll not observed');
  await paint();
  v = await snap('04-poll-failure-after-success');
  check('background503 clears current badge rather than claiming old active or loading', await ev(`${badge}?.textContent.trim()==='Status unavailable' && !${badge}?.classList.contains('badge-active')`), v);
  check('background failure preserves selected directory and its history hint', v.cwd==='./documents' && await ev(`history.state?.takosComputerDirectory?.cwd==='./documents'`), v);
  statusMode = 'rows';
  await retryByKeyboard();
  check('refresh recovers after a background status failure', await ev(`${badge}?.textContent.trim()==='active'`), await snap('05-poll-recovered'));
  await cdp('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:false});
  await click(button('日本語'), 'switch status controls to Japanese at390px');
  statusMode = 'http-error';
  const japaneseButton = `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='状態を更新')`;
  await retryByKeyboard(japaneseButton);
  v = await snap('06-mobile-japanese-error');
  check('status failure and retry are localized at390px', await ev(`${badge}?.textContent.trim()==='状態を取得できません' && !!(${japaneseButton})`), v);
  check('mobile status controls produce no horizontal page overflow', v.viewport.bodyScroll <= v.viewport.bodyClient, v.viewport);
  statusMode = 'rows';
  await retryByKeyboard(japaneseButton);
  check('mobile retry recovers without directory or language loss', await ev(`${badge}?.textContent.trim()==='稼働中' && (${cwd})?.value==='./documents'`), await snap('07-mobile-recovered'));
  await click(button('English'), 'restore English');
  // Session B must not display an old A error or active badge while its GET is pending.
  statusMode = 'http-error'; holdStatusId = 'synthetic';
  await navigate('/gui/sandbox/synthetic?held-status-error=1');
  await wait(rootReady, 'A usable during held error');
  const lateDeadline=Date.now()+3000;
  while(!releaseStatus && Date.now()<lateDeadline) await delay(20);
  if(!releaseStatus)throw Error('held A error missing');
  statusMode='rows';
  await ev(`(()=>{const a=document.createElement('a');a.id='status-route';a.href='/gui/sandbox/${otherSessionId}';a.textContent='Synthetic route';document.body.append(a)})()`);
  await click(`document.getElementById('status-route')`, 'select B while A status error held');
  await wait(`${badge}?.textContent.trim()==='stopped' && (${filesRoot})?.innerText.includes('other-notes.txt')`, 'B owns status and files');
  const beforeLate=completedCount();releaseStatus();releaseStatus=null;
  await settledAfter(beforeLate);
  check('late A503 cannot replace B status with an error', await ev(`${badge}?.textContent.trim()==='stopped'`), await snap('08-late-error-other-session'));
  check("no accidental session creation", creates === 0, creates);
  check("no uncaught page errors", errors.length === 0, errors);
  check("only synthetic allowed endpoints reached", requests.every((x) => !x.kind.startsWith("forbidden")), requests.filter((x) => x.kind.startsWith("forbidden")));
  check("no external page request forwarded", intercepted.every((x) => x.allowed), intercepted.filter((x) => !x.allowed));
} catch (e) {
  fatal = e.stack ?? e.message;
} finally {
  releaseStatus?.();
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      await bounded(Promise.allSettled([...tasks]), "interceptors");
      if (process.env.COMPUTER_STATUS_FAULT === "websocket-close") {
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
const result = { status: fatal ? "HARNESS_ERROR" : failed.length ? "RED" : "PASS", harnessSha256, scope: "Real selected dashboard build, synthetic loopback endpoint only; no real simulator host calls/account/provider/live", dashboardSha256: createHash("sha256").update(html).digest("hex"), browserVersion, chromeStderr, fatal, assertions, failed: failed.map((x) => x.name), actions, actionCount: actions.length, actionCountDefinition: "Recorded pointer/key actions; fixture navigation, programmatic focus and setup are excluded", creates, requests, intercepted, interceptorErrors, errors, snapshots, cleanup };
await writeFile(join(out, "REPORT.json"), JSON.stringify(result, null, 2) + "\n", { mode: 384 });
console.log(JSON.stringify({ status: result.status, failed: result.failed, fatal: result.fatal, actions: actions.length, creates, cleanup, report: join(out, "REPORT.json") }, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
