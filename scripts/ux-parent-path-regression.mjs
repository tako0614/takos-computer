import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
const repo = resolve(process.env.COMPUTER_PARENT_PATH_REPO ?? resolve(import.meta.dirname, ".."));
const out = resolve(process.env.COMPUTER_PARENT_PATH_EVIDENCE ?? await mkdtemp(join(tmpdir(), "computer-parent-path-evidence-")));
await mkdir(out, { recursive: true, mode: 448 });
const harnessSha256 = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
const html = await readFile(join(repo, "packages/computer-hosts/src/gui/app.html"));
const requests = [], actions = [], assertions = [], errors = [], intercepted = [], interceptorErrors = [], snapshots = {};
const pending = /* @__PURE__ */ new Map(), tasks = /* @__PURE__ */ new Set();
const networkFinished = new Set();
const dialogs = [], fileCalls = [], fileNetwork = [], deliveredFiles = [];
const { WorkspaceJail } = await import(pathToFileURL(join(repo, "packages/sandbox-service/src/workspace-jail.ts")));
// Exercise only production lexical resolution/containment: never realpath or a host tool.
const jail = new WorkspaceJail("/synthetic/workspace");
let nextId = 1, ws, chrome, chromeExit, profile, fixturePort, debugPort, fatal = null;
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
      requests.push({ kind: "session-list" });
      return send(res, 200, { sessions: sessionIds.map((sessionId) => ({ ...session, sessionId })) });
    }
    const id = sessionIds.find((id) => u.pathname === "/gui/api/sandbox-session/" + id);
    if (id && req.method === "GET") return send(res, 200, { ...session, sessionId: id });
    const mcpId = sessionIds.find((id2) => u.pathname === "/gui/api/sandbox-session/" + id2 + "/mcp");
    if (mcpId && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const call = JSON.parse(raw), tool = call.params?.name, path = call.params?.arguments?.path;
      if (!["file_list", "process_list"].includes(tool)) {
        requests.push({ kind: "forbidden-tool", tool });
        return send(res, 403, { error: "No host tool calls" });
      }
      requests.push({ kind: "synthetic-tool", tool, path, sessionId: mcpId });
      if (tool === "process_list") return send(res, 200, { jsonrpc: "2.0", id: call.id, result: { content: [{ type: "text", text: '{"processes":[]}' }] } });
      const record = { callId: call.id, sessionId: mcpId, path };
      fileCalls.push(record);
      let result;
      try {
        const lexical = jail.resolveLexicalPath(path);
        jail.assertInsideWorkspace(lexical);
        record.lexical = lexical;
        const entries = lexical === "/synthetic/workspace" ? [entry("documents", "directory"), entry("root.txt")]
          : lexical === "/synthetic/workspace/documents" ? [entry("archive", "directory"), entry("draft.md")]
          : lexical === "/synthetic/workspace/documents/archive" ? [entry("retained.txt")]
          : lexical === "/synthetic/workspace/..foo" ? [entry("literal-name.txt")]
          : null;
        result = entries ? { content: [{ type: "text", text: JSON.stringify({ entries }) }] }
          : { isError: true, content: [{ type: "text", text: "Synthetic unavailable directory" }] };
      } catch {
        record.outside = true;
        result = { isError: true, content: [{ type: "text", text: "Synthetic outside workspace refusal" }] };
      }
      return send(res, 200, { jsonrpc: "2.0", id: call.id, result });
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
  profile = await mkdtemp(join(tmpdir(), "computer-parent-path-chrome-"));
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
      const request = m.params.request;
      if (request.method === "POST" && new URL(request.url).pathname.endsWith("/mcp")) {
        const rpc = JSON.parse(request.postData);
        if (rpc.params?.name === "file_list") fileNetwork.push({ requestId: m.params.requestId, callId: rpc.id, path: rpc.params.arguments.path });
      }
    } else if (m.method === "Network.loadingFinished") networkFinished.add(m.params.requestId);
    else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === "Page.javascriptDialogOpening") {
      dialogs.push({ type: m.params.type });
      const task = cdp("Page.handleJavaScriptDialog", { accept: false }).catch((e) => interceptorErrors.push(e.message)).finally(() => tasks.delete(task));
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
  if (process.env.COMPUTER_PARENT_PATH_FAULT === "missing-dom") {
    await navigate("/gui");
    await wait(`document.querySelector('[data-forced-missing-fixture]')`, "intentional missing DOM", 300);
  }
  const snapshotsCount = () => Object.keys(snapshots).length;
  const up = `document.querySelector('button[aria-label="Parent directory"],button[aria-label="Workspace root"]')`;
  async function settleNewRead(before, label) {
    const end = Date.now() + 3000;
    while (Date.now() < end && !(fileNetwork.length > before && networkFinished.has(fileNetwork.at(-1).requestId))) await delay(20);
    if (!(fileNetwork.length > before && networkFinished.has(fileNetwork.at(-1).requestId))) throw Error(label + " response not observed by browser");
    const response = fileNetwork.at(-1);
    if (!deliveredFiles.some(x => x.requestId === response.requestId)) deliveredFiles.push({ ...response, loadingFinished: true });
    await ev("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  }
  async function setPath(path) {
    await click(cwd, "focus directory input");
    await ev(`(${cwd}).select()`);
    const before = fileNetwork.length;
    await cdp("Input.insertText", { text: path });
    actions.push({ action: "edit directory path " + path, kind: "keyboard", at: Date.now() });
    await settleNewRead(before, "directory input");
  }
  async function parent() {
    await key("Tab", "Tab", 8);
    check("Shift+Tab from path reaches named Up", await ev(`document.activeElement===(${up})`), await ev("document.activeElement?.outerHTML"));
    const before = fileNetwork.length;
    await key("Enter");
    await settleNewRead(before, "Up");
  }
  await navigate("/gui");
  await wait(`document.querySelector('tbody a')`, "session navigation");
  const beforeOpen = fileNetwork.length;
  await click(`document.querySelector('tbody a')`, "open synthetic session");
  await settleNewRead(beforeOpen, "initial directory");
  await setPath("./documents/.");
  check("production lexical jail treats dot suffix as documents", fileCalls.at(-1).lexical === "/synthetic/workspace/documents" && await ev(`(${filesRoot}).innerText.includes('draft.md')`), await snap("01-dot-suffix"));
  await parent();
  let v = await snap("02-dot-suffix-Up");
  check("one Up from dot-suffix documents reaches workspace root", v.cwd === "." && v.fileText?.includes("root.txt"), v);
  await setPath("./documents/archive/../archive");
  check("production lexical jail treats internal parent as archive", fileCalls.at(-1).lexical === "/synthetic/workspace/documents/archive" && await ev(`(${filesRoot}).innerText.includes('retained.txt')`), await snap("03-internal-parent"));
  await parent();
  v = await snap("04-internal-parent-Up");
  check("one Up from internal-parent archive reaches documents, not workspace root", v.cwd === "./documents" && v.fileText?.includes("draft.md") && !v.fileText?.includes("root.txt"), v);
  // Literal expected parents are independent of the production UI algorithm.
  for (const [path, beforeText, expectedPath, afterText] of [
    ["./documents/./archive/.", "retained.txt", "./documents", "draft.md"],
    ["documents//archive//", "retained.txt", "documents", "draft.md"],
    ["./documents/archive/../../", "root.txt", ".", "root.txt"],
    ["./documents/../..foo/.", "literal-name.txt", ".", "root.txt"],
  ]) {
    await setPath(path);
    check("accepted lexical alias lists its selected directory: " + path, await ev(`(${filesRoot}).innerText.includes(${JSON.stringify(beforeText)})&&!document.querySelector('[role=alert]')`), fileCalls.at(-1));
    await parent();
    check("Up resolves one lexical level: " + path, await ev(`(${cwd}).value===${JSON.stringify(expectedPath)}&&(${filesRoot}).innerText.includes(${JSON.stringify(afterText)})`), await snap("alias-" + snapshotsCount()));
  }
  // Outside paths never become authority, even when Up recovers the known root.
  for (const path of ["../outside", "/synthetic/not-workspace"]) {
    await setPath(path);
    check("production containment rejects selected outside path: " + path, fileCalls.at(-1).outside === true && await ev(`!!document.querySelector('[role=alert]')`), await snap("refused-" + snapshotsCount()));
    await parent();
    check("Up after refusal explicitly recovers known workspace root: " + path, await ev(`(${cwd}).value==='.'&&(${filesRoot}).innerText.includes('root.txt')&&!document.querySelector('[role=alert]')`), fileCalls.at(-1));
  }
  const beforeRoot = fileCalls.length;
  await click(up, "root Up remains disabled");
  await ev("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  check("root Up stays disabled without another request", await ev(`(${up}).disabled`) && fileCalls.length === beforeRoot, fileCalls.slice(-2));
  // The normalized parent follows the original same-session history contract.
  await ev(`history.replaceState({...history.state, fixtureSibling:'retained'},'',location.href)`);
  await setPath("./documents/archive/../archive"); await parent();
  let state = await ev("({state:history.state,url:location.pathname+location.search+location.hash,length:history.length})");
  check("canonical parent retains unrelated router state without putting cwd in URL", state.state.fixtureSibling === "retained" && state.state.takosComputerDirectory.sessionId === "synthetic" && state.state.takosComputerDirectory.cwd === "./documents" && state.url === "/gui/sandbox/synthetic", state);
  const history = await cdp("Page.getNavigationHistory");
  await click(`[...document.querySelectorAll('a')].find(e=>e.textContent.includes('Dashboard'))`, "leave normalized directory through Dashboard");
  await wait(`document.querySelector('tbody a')`, "Dashboard before real Back");
  const beforeBack = fileNetwork.length;
  actions.push({ action: "browser Back to canonical parent", kind: "browser-history", at: Date.now() });
  await cdp("Page.navigateToHistoryEntry", { entryId: history.entries[history.currentIndex].id });
  await settleNewRead(beforeBack, "Back directory");
  check("real Back restores canonical parent in original session", await ev(`(${cwd}).value==='./documents'&&(${filesRoot}).innerText.includes('draft.md')&&history.state.fixtureSibling==='retained'`), await snap("history-back"));
  const beforeReload = fileNetwork.length;
  actions.push({ action: "reload canonical parent", kind: "browser-reload", at: Date.now() });
  await cdp("Page.reload"); await settleNewRead(beforeReload, "reload directory");
  check("reload retains same-session canonical parent and router fields", await ev(`(${cwd}).value==='./documents'&&(${filesRoot}).innerText.includes('draft.md')&&history.state.fixtureSibling==='retained'`), await snap("history-reload"));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await setPath("./documents/./archive/."); await parent();
  v = await snap("mobile-parent");
  check("390px keyboard Up preserves usable parent view without overflow", v.cwd === "./documents" && v.fileText?.includes("draft.md") && v.viewport.bodyScroll <= v.viewport.bodyClient && await ev(`document.activeElement===(${up})||document.activeElement===(${cwd})`), v);
  check("all selected directory replies were observed by browser", deliveredFiles.length === fileCalls.length, { delivered: deliveredFiles.length, calls: fileCalls.length });
  check("no lifecycle action or native dialog occurred", creates === 0 && dialogs.length === 0, { creates, dialogs });
  check("only synthetic read endpoints were reached", requests.every(x => !x.kind.startsWith("forbidden")), requests.filter(x => x.kind.startsWith("forbidden")));
  check("no external request was forwarded", intercepted.every(x => x.allowed), intercepted.filter(x => !x.allowed));
  check("no uncaught browser error", errors.length === 0, errors);
} catch (e) {
  fatal = e.stack ?? e.message;
} finally {
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      await bounded(Promise.allSettled([...tasks]), "interceptors");
      if (process.env.COMPUTER_PARENT_PATH_FAULT === "websocket-close") {
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
const result = { status: fatal ? "HARNESS_ERROR" : failed.length ? "RED" : "PASS", harnessSha256, scope: "Actual built UI parent navigation and production lexical jail only; synthetic read responses, no native host filesystem/process/lifecycle/provider/auth/live", dashboardSha256: createHash("sha256").update(html).digest("hex"), browserVersion, chromeStderr, fatal, assertions, failed: failed.map((x) => x.name), actions, actionCount: actions.length, actionCountDefinition: "semantic pointer/key/path/browser actions; bulk text entry is not a physical-keystroke count", creates, fileCalls, deliveredFiles, dialogs, requests, intercepted, interceptorErrors, errors, snapshots, cleanup };
await writeFile(join(out, "REPORT.json"), JSON.stringify(result, null, 2) + "\n", { mode: 384 });
console.log(JSON.stringify({ status: result.status, failed: result.failed, fatal: result.fatal, actions: actions.length, creates, cleanup, report: join(out, "REPORT.json") }, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
