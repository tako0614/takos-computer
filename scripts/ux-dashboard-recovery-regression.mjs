import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import { tmpdir } from "node:os";
const repo = resolve(process.env.COMPUTER_DASHBOARD_REPO ?? resolve(import.meta.dirname, ".."));
const out = resolve(process.env.COMPUTER_DASHBOARD_EVIDENCE ?? await mkdtemp(join(tmpdir(), "computer-dashboard-evidence-")));
await mkdir(out, { recursive: true, mode: 448 });
const harnessSha256 = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
const html = await readFile(join(repo, "packages/computer-hosts/src/gui/app.html"));
const requests = [], actions = [], assertions = [], errors = [], intercepted = [], interceptorErrors = [], snapshots = {};
const pending = /* @__PURE__ */ new Map(), tasks = /* @__PURE__ */ new Set();
let nextId = 1, ws, chrome, chromeExit, profile, fixturePort, debugPort, fatal = null;
let holdStatusId = null, releaseStatus = null, statusMode = "rows";
let chromeStderr = "";
let creates = 0, cleanup = {}, browserVersion, networkOffline = false, listMode = "rows", holdList = false, releaseSessionList = null;
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
      const outcome=listMode;
      requests.push({ kind: "session-list", outcome });
      if(holdList){holdList=false;await new Promise(resolve=>releaseSessionList=resolve)}
      requests.push({kind:'session-list-completed',outcome});
      if(outcome==='http-error')return send(res,503,{error:'Synthetic list unavailable'});
      return send(res, 200, { sessions: outcome==='empty'?[]:[session] });
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
  profile = await mkdtemp(join(tmpdir(), "computer-dashboard-chrome-"));
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
      const failedApi = allowed && networkOffline && u.pathname.startsWith('/gui/api/');
      if (failedApi) requests.push({kind:'synthetic-network-failure',method:m.params.request.method,path:u.pathname});
      const t = cdp(allowed && !failedApi ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed && !failedApi ? {requestId:m.params.requestId} : {requestId:m.params.requestId,errorReason:failedApi ? 'InternetDisconnected' : 'BlockedByClient'}).catch(e=>interceptorErrors.push(e.message)).finally(()=>tasks.delete(t));
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
  if (process.env.COMPUTER_DASHBOARD_FAULT === "missing-dom") {
    await navigate("/gui");
    await wait(`document.querySelector('[data-forced-missing-fixture]')`, "intentional missing DOM", 300);
  }
  const rootReady = `(${filesRoot})?.innerText.includes('notes.txt') && !(${filesRoot})?.innerText.includes('Loading')`;
  const badge = `document.querySelector('.badge')`;
  const statusButton = `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Refresh status')`;
  const fileButton = `[...(${filesRoot})?.querySelectorAll('button')].find(e=>e.textContent.trim()==='Refresh')`;
  await navigate('/gui/sandbox/synthetic');
  await wait(rootReady, 'selected session ready');
  await click(folder, 'open documents');
  await wait(`(${cwd})?.value==='./documents'&&(${filesRoot})?.innerText.includes('draft.md')`, 'documents ready');
  networkOffline = true;
  await click(fileButton, 'refresh file list during API transport failure');
  await wait(`(${filesRoot})?.querySelector('[role=alert]')`, 'transport failure visible');
  let v=await snap('01-file-transport-failure');
  check('network failure is an explicit file error, not empty or old rows', v.alerts.length>0 && !v.fileText.includes('Empty directory') && !v.fileText.includes('draft.md'),v);
  await click(statusButton, 'refresh status during API transport failure');
  await wait(`${badge}?.textContent.trim()==='Status unavailable'`, 'status failure visible');
  actions.push({action:'reload current session while API unreachable',kind:'browser',at:Date.now()});
  await cdp('Page.reload');
  await wait(`(${cwd})&&(${filesRoot})?.querySelector('[role=alert]')&&${badge}?.textContent.trim()==='Status unavailable'`, 'reloaded failure settles');
  v=await snap('02-reload-during-api-offline');
  check('reload retains cwd and its same-session history scope during transport failure', v.cwd==='./documents' && await ev(`history.state?.takosComputerDirectory?.sessionId==='synthetic'`),v);
  check('offline reload remains an actionable failure, not perpetual loading', v.alerts.length>0 && !v.fileText.includes('Loading') && !v.fileText.includes('Empty directory') && await ev(`!!(${fileButton})&&!!(${statusButton})`),v);
  networkOffline=false;
  await click(fileButton, 'refresh files after reconnection');
  await wait(`(${filesRoot})?.innerText.includes('draft.md')&&!(${filesRoot})?.querySelector('[role=alert]')`,'files reconnect');
  await click(statusButton,'refresh status after reconnection');
  await wait(`${badge}?.textContent.trim()==='active'`,'status reconnect');
  v=await snap('03-reconnected');
  check('reconnection recovers original directory with one refresh per affected panel', v.cwd==='./documents' && !v.fileText.includes('Error:') && v.fileText.includes('draft.md'),v);
  // Read-only additional entry seam: never create/destroy a session.
  networkOffline=true;
  await click(`[...document.querySelectorAll('a')].find(e=>e.textContent.includes('Dashboard'))`,'return Dashboard while API offline');
  await wait(`location.pathname==='/gui'||location.pathname==='/gui/'`,'Dashboard route');
  await delay(500);
  v=await snap('04-dashboard-network-failure');
  check('dashboard failure keeps the app visible and distinguishes failure from a true empty list',v.body.includes('takos computer') && !v.body.includes('No sessions') && /unavailable|error|failed|失敗|取得でき/i.test(v.body),v);
  const refreshSessions=`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Refresh sessions')`;
  check('failed dashboard provides explicit manual recovery', await ev(`!!(${refreshSessions})`),v);
  networkOffline=false;
  if(await ev(`!!(${refreshSessions})`)) {
    holdList=true;
    const before=intercepted.filter(x=>x.path==='/gui/api/sandbox-sessions').length;
    await ev(`(${refreshSessions}).focus()`);
    await key('Enter');
    const deadline=Date.now()+3000;while(!releaseSessionList&&Date.now()<deadline)await delay(20);
    if(!releaseSessionList)throw Error('manual list retry not captured');
    v=await snap('05-dashboard-retry-pending');
    check('pending list retry is visibly loading and manual button is aria-disabled',v.body.includes('Loading...') && await ev(`(${refreshSessions}).getAttribute('aria-disabled')==='true'`),v);
    await key('Enter');
    await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    check('held manual retry cannot issue a second list GET',intercepted.filter(x=>x.path==='/gui/api/sandbox-sessions').length===before+1,intercepted.filter(x=>x.path==='/gui/api/sandbox-sessions'));
    releaseSessionList();releaseSessionList=null;
    await wait(`[...document.querySelectorAll('a')].some(e=>e.textContent.trim()==='Open')`,'manual dashboard reconnect');
    v=await snap('06-dashboard-manual-recovered');
    check('one keyboard retry recovers original session and retains focus without reload',v.body.includes('synthetic')&&await ev(`document.activeElement===(${refreshSessions})`),v);
    listMode='empty';
    await click(refreshSessions,'read a genuine empty session list');
    await wait(`document.body.innerText.includes('No sessions')`,'true empty list');
    check('successful empty list remains distinct from failure',await ev(`!document.querySelector('[role=alert]')`),await snap('07-true-empty'));
    listMode='http-error';
    await click(refreshSessions,'read503 after a genuine empty result');
    await wait(`document.querySelector('[role=alert]')`,'list503');
    v=await snap('08-http503-after-empty');
    check('completed503 replaces empty list with explicit error',v.alerts.length===1&&!v.body.includes('No sessions')&&!v.body.includes('Loading...'),v);
    await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await click(button('日本語'),'switch dashboard failure to Japanese390px');
    v=await snap('09-mobile-japanese-error');
    check('mobile failure and recovery action are localized without page overflow',v.body.includes('セッション一覧を取得できません')&&v.body.includes('一覧を更新')&&v.viewport.bodyScroll<=v.viewport.bodyClient,v);
    listMode='rows';
    await click(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='一覧を更新')`,'recover list at390px');
    await wait(`document.body.innerText.includes('synthetic')&&!document.querySelector('[role=alert]')`,'Japanese list recovery');
    check('mobile retry restores original row',true,await snap('10-mobile-recovered'));
    await click(button('English'),'restore English for automatic-poll recovery');
    listMode='http-error';
    await click(refreshSessions,'set up a list failure before automatic recovery');
    await wait(`document.querySelector('[role=alert]')`,'list failure before originalpoll');
    const pollsBefore=requests.filter(x=>x.kind==='session-list').length;
    listMode='rows';
    await wait(`[...document.querySelectorAll('a')].some(e=>e.textContent.trim()==='Open')&&!document.querySelector('[role=alert]')`,'original10second automatic list recovery',12000);
    check('original10second poll recovers the failed list without manual retry or reload',requests.filter(x=>x.kind==='session-list').length>pollsBefore,await snap('11-original-poll-recovery'));

  } else {
    actions.push({action:'reload dashboard after reconnection (baseline has no direct retry)',kind:'browser',at:Date.now()});
    await cdp('Page.reload');
    await wait(`[...document.querySelectorAll('a')].some(e=>e.textContent.trim()==='Open')`,'dashboard reconnect');
    check('baseline can recover original session only after reconnect/reload in this flow',await ev(`document.body.innerText.includes('synthetic')`),await snap('05-baseline-reload-recovered'));
  }
  check("no accidental session creation", creates === 0, creates);
  check("no uncaught page errors", errors.length === 0, errors);
  check("only synthetic allowed endpoints reached", requests.every((x) => !x.kind.startsWith("forbidden")), requests.filter((x) => x.kind.startsWith("forbidden")));
  check("no external page request forwarded", intercepted.every((x) => x.allowed), intercepted.filter((x) => !x.allowed));
} catch (e) {
  fatal = e.stack ?? e.message;
} finally {
  releaseStatus?.();
  releaseSessionList?.();
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      await bounded(Promise.allSettled([...tasks]), "interceptors");
      if (process.env.COMPUTER_DASHBOARD_FAULT === "websocket-close") {
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
const result = { status: fatal ? "HARNESS_ERROR" : failed.length ? "RED" : "PASS", harnessSha256, scope: "Actual selected dashboard build, synthetic loopback only; no real simulator host/account/provider/live", dashboardSha256: createHash("sha256").update(html).digest("hex"), browserVersion, chromeStderr, fatal, assertions, failed: failed.map((x) => x.name), actions, actionCount: actions.length, actionCountDefinition: "Recorded pointer/key actions; fixture navigation, programmatic focus and setup are excluded", creates, requests, intercepted, interceptorErrors, errors, snapshots, cleanup };
await writeFile(join(out, "REPORT.json"), JSON.stringify(result, null, 2) + "\n", { mode: 384 });
console.log(JSON.stringify({ status: result.status, failed: result.failed, fatal: result.fatal, actions: actions.length, creates, cleanup, report: join(out, "REPORT.json") }, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
