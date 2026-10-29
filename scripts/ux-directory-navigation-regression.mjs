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
const html = await readFile(join(repo, "packages/computer-hosts/src/gui/app.html"));
const requests = [], actions = [], assertions = [], errors = [], intercepted = [], interceptorErrors = [], snapshots = {};
const pending = /* @__PURE__ */ new Map(), tasks = /* @__PURE__ */ new Set();
let nextId = 1, ws, chrome, chromeExit, profile, fixturePort, debugPort, fatal = null, mode = "rows", releaseList = null;
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
    if (req.method === "GET" && u.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "GET" && u.pathname === "/gui/api/sandbox-sessions") {
      requests.push({ kind: "session-list" });
      return send(res, 200, { sessions: [session] });
    }
    if (req.method === "GET" && sessionIds.some((id) => u.pathname === "/gui/api/sandbox-session/" + id)) {
      requests.push({ kind: "session-status" });
      return send(res, 200, session);
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
        const selectedMode = mode;
        if (selectedMode === "held") await new Promise((resolve2) => {
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
  if (process.env.COMPUTER_NAV_FAULT === "missing-dom") {
    await navigate("/gui");
    await wait(`document.querySelector('[data-forced-missing-fixture]')`, "intentional missing DOM", 300);
  }
  await navigate("/gui");
  await click(`[...document.querySelectorAll('a')].find(e=>e.textContent.trim()==='Open')`, "open synthetic session");
  await wait(`(${filesRoot})?.innerText.includes('notes.txt')`, "root ready");
  let s = await snap("01-desktop-root");
  const pathLabel = await ev(`(()=>{const e=${cwd};return e.getAttribute('aria-label')||[...(e.labels??[])].map(x=>x.textContent).join(' ')||(e.getAttribute('aria-labelledby')||'').split(' ').map(id=>document.getElementById(id)?.textContent??'').join(' ');})()`);
  check("path input has a programmatic accessible name", pathLabel.trim().length > 0, pathLabel);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  s = await snap("02-mobile-root");
  check("whole 390px page has no horizontal overflow", s.viewport.bodyScroll <= s.viewport.bodyClient + 1, s.viewport);
  const up = `document.querySelector('button[aria-label="Parent directory"],button[aria-label="Workspace root"]')`;
  const hasUp = await ev(`!!(${up})`);
  check("named Up control exists", hasUp, hasUp);
  if (hasUp) {
    const state = await ev(`({disabled:(${up}).disabled,name:(${up}).getAttribute('aria-label')||(${up}).textContent})`);
    check("Up is named and disabled at root", state.disabled && state.name.trim().length > 1, state);
    const before = requests.filter((x) => x.tool === "file_list").length;
    await click(up, "disabled root Up");
    await delay(80);
    check("root Up cannot request above workspace", requests.filter((x) => x.tool === "file_list").length === before, requests.filter((x) => x.tool === "file_list").slice(-2));
  }
  await click(folder, "enter documents");
  await wait(`(${cwd}).value==='./documents'&&(${filesRoot})?.innerText.includes('draft.md')`, "documents ready");
  if (hasUp) {
    await ev(`(${cwd}).focus()`);
    await key("Tab", "Tab", 8);
    check("Shift+Tab from path reaches Up", await ev(`document.activeElement===(${up})`), await snap("03-up-focus"));
    await key("Tab");
    check("Tab from Up reaches path input", await ev(`document.activeElement===(${cwd})`), await ev('document.activeElement?.getAttribute("aria-label")'));
    await key("Tab", "Tab", 8);
    await key("Enter");
    await wait(`(${cwd}).value==='.'&&(${filesRoot})?.innerText.includes('notes.txt')`, "keyboard Up returns root");
    check("one Enter on Up completes parent navigation", true, await snap("04-up-root"));
  } else await setPath(".");
  await setPath("documents");
  await wait(`!(${filesRoot})?.innerText.includes('Loading')`, "bare relative ready");
  if (hasUp) {
    await click(up, "Up from bare relative");
    await wait(`(${cwd}).value==='.'`, "bare relative parent");
    check("bare relative folder parent is root", true, await ev(`(${cwd}).value`));
  } else await setPath(".");
  await setPath("./documents/archive");
  await key("Enter");
  await wait(`(${filesRoot})?.innerText.includes('retained.txt')`, "nested list ready");
  if (hasUp) {
    await click(up, "nested Up");
    await wait(`(${cwd}).value==='./documents'`, "nested parent");
    check("nested Up returns one parent", true, await ev(`(${cwd}).value`));
  } else await setPath("./documents");
  mode = "http-error";
  await refresh();
  await wait(`document.querySelector('[role=alert]')`, "visible failure");
  s = await snap("05-failed-list");
  check("failed listing stays visible with usable path controls", s.alerts.length === 1 && !s.fileText.includes("Empty directory"), s);
  mode = "rows";
  await refresh();
  await wait(`(${filesRoot})?.innerText.includes('draft.md')&&!document.querySelector('[role=alert]')`, "recovered list");
  check("Refresh recovers current folder after error", true, await snap("06-recovered"));
  await cdp("Page.reload");
  await wait(`(${cwd})&&!(${filesRoot})?.innerText.includes('Loading')`, "reload ready");
  s = await snap("07-reload");
  check("same session reload preserves cwd", s.cwd === "./documents", s.cwd);
  check("cwd is absent from URL", !s.url.includes("documents"), s.url);
  await setPath("./documents");
  await wait(`(${filesRoot})?.innerText.includes('draft.md')`, "restore after baseline reload");
  await click(`[...document.querySelectorAll('a')].find(e=>e.textContent.includes('Dashboard'))`, "Back to dashboard");
  await wait(`${button("+ Sandbox Session")}`, "dashboard");
  const h = await cdp("Page.getNavigationHistory");
  actions.push({ action: "browser Back to same session", kind: "browser", at: Date.now() });
  await cdp("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex - 1].id });
  await wait(`(${cwd})&&!(${filesRoot})?.innerText.includes('Loading')`, "Back session");
  s = await snap("08-history-back");
  check("browser Back restores same entry cwd", s.cwd === "./documents", s.cwd);
  await cdp("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex].id });
  await wait(`${button("+ Sandbox Session")}`, "Forward dashboard");
  await cdp("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex - 1].id });
  await wait(`(${cwd})&&!(${filesRoot})?.innerText.includes('Loading')`, "second Back");
  check("Forward then Back retains session entry cwd", await ev(`(${cwd}).value==='./documents'`), await ev(`(${cwd}).value`));
  await setPath(".");
  await wait(`(${filesRoot})?.innerText.includes('notes.txt')`, "first root before session switch");
  const secondReadsBefore = requests.filter((x) => x.sessionId === otherSessionId && x.tool === "file_list").length;
  await ev(`(()=>{const a=document.createElement('a');a.href='/gui/sandbox/${otherSessionId}';a.id='synthetic-root-route';a.textContent='Other root';document.body.append(a)})()`);
  await click(`document.getElementById('synthetic-root-route')`, "same-cwd other session");
  await wait(`location.pathname.endsWith('${otherSessionId}')&&(${cwd}).value==='.'`, "same-cwd route");
  await wait(`(${filesRoot})?.innerText.includes('other-notes.txt')`, "second session listing");
  check("same-cwd session change fetches its own listing", requests.filter((x) => x.sessionId === otherSessionId && x.tool === "file_list").length > secondReadsBefore && await ev(`(${filesRoot})?.innerText.includes('other-notes.txt')`), await snap("08b-same-cwd-session"));
  await navigate("/gui/sandbox/synthetic");
  await wait(`(${filesRoot})?.innerText.includes('notes.txt')`, "first session again");
  await setPath("./documents");
  await wait(`(${filesRoot})?.innerText.includes('draft.md')`, "first docs again");
  await ev(`history.replaceState({...history.state,routerSentinel:{nested:'preserved'}},'')`);
  await cdp("Page.reload");
  await wait(`(${filesRoot})?.innerText.includes('draft.md')`, "seeded router state");
  await setPath("");
  check("cleared path stays editable", await ev(`(${cwd}).value === ''`), await ev(`(${cwd}).value`));
  for (const character of "documents") await cdp("Input.insertText", { text: character });
  actions.push({ action: "type documents without waiting for intermediate listings", kind: "keyboard", at: Date.now() });
  await wait(`(${cwd}).value === 'documents' && (${filesRoot})?.innerText.includes('draft.md') && !document.querySelector('[role=alert]')`, "rapid input settled");
  check("rapid edits retain final path in history", await ev(`history.state.takosComputerDirectory.cwd === 'documents'`), await ev("history.state"));
  const originalDepth = await ev("history.state._depth");
  const originalLength = await ev("history.length");
  await setPath("./documents/archive");
  await wait(`(${filesRoot})?.innerText.includes('retained.txt')`, "retained nested cwd");
  check("cwd update preserves router and unrelated state", await ev(`history.state.routerSentinel.nested==='preserved'&&history.state._depth===${JSON.stringify(originalDepth)}`), await ev("history.state"));
  check("directory navigation replaces rather than grows history", await ev(`history.length===${originalLength}`), await ev("history.length"));
  await ev(`(()=>{const a=document.createElement('a');a.href='/gui/sandbox/${otherSessionId}';a.id='synthetic-other-route';a.textContent='Other synthetic session';document.body.append(a)})()`);
  await click(`document.getElementById('synthetic-other-route')`, "router link to another session");
  await wait(`location.pathname.endsWith('${otherSessionId}')&&(${cwd}).value==='.'&&(${filesRoot})?.innerText.includes('notes.txt')`, "new session root");
  check("reactive session change starts at root", await ev(`(${cwd}).value==='.'`), await snap("09-other-session-root"));
  check("long session ID toolbar still fits 390px", await ev("document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"), await ev("({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})"));
  await setPath("./documents");
  await wait(`(${filesRoot})?.innerText.includes('draft.md')`, "other cwd");
  let nh = await cdp("Page.getNavigationHistory");
  await cdp("Page.navigateToHistoryEntry", { entryId: nh.entries[nh.currentIndex - 1].id });
  await wait(`location.pathname==='/gui/sandbox/synthetic'&&(${cwd}).value==='./documents/archive'`, "Back restores first session entry");
  check("different sessions retain independent entry paths", true, await snap("10-first-session-restored"));
  await cdp("Page.navigateToHistoryEntry", { entryId: nh.entries[nh.currentIndex].id });
  await wait(`location.pathname.endsWith('${otherSessionId}')&&(${cwd}).value==='./documents'`, "Forward restores second session entry");
  check("Forward restores second entry without sharing first path", true, await ev("history.state"));
  await navigate("/gui/sandbox/synthetic?fixture=1#directory");
  await wait(`(${filesRoot})?.innerText.includes('notes.txt')`, "query route");
  await setPath("./documents");
  await wait(`(${filesRoot})?.innerText.includes('draft.md')`, "query path");
  check("same-URL router update preserves base query and hash", await ev(`location.pathname+location.search+location.hash==='/gui/sandbox/synthetic?fixture=1#directory'`), await ev("location.href"));
  for (const bad of [null, [], { version: 2, sessionId: "synthetic", cwd: "./documents" }, { version: 1, sessionId: otherSessionId, cwd: "./documents" }, { version: 1, sessionId: "synthetic", cwd: 9 }, { version: 1, sessionId: "synthetic", cwd: "bad" + String.fromCharCode(0) + "path" }]) {
    await ev(`history.replaceState({...history.state,takosComputerDirectory:${JSON.stringify(bad)}},'')`);
    await cdp("Page.reload");
    await wait(`(${cwd})&&!(${filesRoot})?.innerText.includes('Loading')`, "invalid scope reload");
    check("invalid or foreign history scope restores root " + JSON.stringify(bad), await ev(`(${cwd}).value==='.'`), await ev(`(${cwd}).value`));
  }
  for (const configuredRoot of ["/home/sandbox/workspace", "/synthetic/custom-workspace"]) {
    workspaceRoot = configuredRoot;
    await setPath(configuredRoot);
    await wait(`(${filesRoot})?.innerText.includes('notes.txt')`, "configured absolute workspace root");
    const countBeforeRoot = requests.filter((x) => x.tool === "file_list").length;
    await click(up, "absolute path root control");
    await wait(`(${cwd}).value !== '${configuredRoot}' && !(${filesRoot})?.innerText.includes('Loading')`, "absolute control settled");
    check("absolute root control returns to relative workspace root " + configuredRoot, await ev(`(${cwd}).value === '.' && (${filesRoot})?.innerText.includes('notes.txt')`), await snap("absolute-root-" + (configuredRoot.includes("custom") ? "custom" : "default")));
    check("absolute root control never requests outside parent " + configuredRoot, requests.filter((x) => x.tool === "file_list").slice(countBeforeRoot).every((x) => x.path === "."), requests.filter((x) => x.tool === "file_list").slice(countBeforeRoot));
  }
  await setPath("/");
  await wait(`document.querySelector('[role=alert]')`, "absolute outside-root refused");
  check("filesystem slash remains outside-workspace failure", true, await snap("11-slash-refused"));
  await click(up, "workspace root recovery from slash");
  await wait(`(${cwd}).value === '.' && (${filesRoot})?.innerText.includes('notes.txt')`, "slash recovery");
  await setPath("../outside");
  await wait(`document.querySelector('[role=alert]')`, "synthetic jail refusal");
  check("outside path refusal remains an error", true, await snap("11-outside-refusal"));
  await click(up, "Up recovers invalid relative input");
  await wait(`(${cwd}).value==='.'&&(${filesRoot})?.innerText.includes('notes.txt')`, "root recovery");
  check("Up recovery does not request parent of workspace", requests.filter((x) => x.tool === "file_list").every((x) => x.path !== ".."), requests.filter((x) => x.tool === "file_list").slice(-3));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  s = await snap("12-desktop-final");
  check("desktop also fits without horizontal overflow", s.viewport.bodyScroll <= s.viewport.bodyClient + 1, s.viewport);
  check("no path persisted in localStorage", await ev(`!Object.values(localStorage).some(v=>v.includes('documents')||v.includes('outside'))`), await ev("Object.keys(localStorage)"));
  check("no accidental session creates", creates === 0, creates);
  check("no uncaught errors", errors.length === 0, errors);
  check("no external browser request forwarded", intercepted.every((x) => x.allowed), intercepted.filter((x) => !x.allowed));
  check("no authority or unexpected endpoint reached", requests.every((x) => !x.kind.startsWith("forbidden")), requests.filter((x) => x.kind.startsWith("forbidden")));
} catch (e) {
  fatal = e.stack ?? e.message;
} finally {
  releaseList?.();
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
const result = { status: fatal ? "HARNESS_ERROR" : failed.length ? "RED" : "PASS", scope: "Real publicmain dashboard build, synthetic loopback endpoint only; no real simulator host calls/account/provider/live", dashboardSha256: createHash("sha256").update(html).digest("hex"), browserVersion, fatal, assertions, failed: failed.map((x) => x.name), actions, actionCount: actions.length, actionCountDefinition: "semantic pointer/key/path/browser actions; bulk text entry is not a physical-keystroke count", creates, requests, intercepted, interceptorErrors, errors, snapshots, cleanup };
await writeFile(join(out, "REPORT.json"), JSON.stringify(result, null, 2) + "\n", { mode: 384 });
console.log(JSON.stringify({ status: result.status, failed: result.failed, fatal: result.fatal, actions: actions.length, creates, cleanup, report: join(out, "REPORT.json") }, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
