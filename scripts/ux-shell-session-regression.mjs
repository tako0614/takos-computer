import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
const repo = resolve(process.env.COMPUTER_SHELL_SESSION_REPO ?? resolve(import.meta.dirname, ".."));
const out = resolve(process.env.COMPUTER_SHELL_SESSION_EVIDENCE ?? await mkdtemp(join(tmpdir(), "computer-shell-session-evidence-")));
await mkdir(out, { recursive: true, mode: 448 });
const harnessSha256 = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
const html = await readFile(join(repo, "packages/computer-hosts/src/gui/app.html"));
const requests = [], actions = [], assertions = [], errors = [], intercepted = [], interceptorErrors = [], snapshots = {};
const pending = /* @__PURE__ */ new Map(), tasks = /* @__PURE__ */ new Set();
const networkFinished = new Set();
const dialogs = [], fileCalls = [], fileNetwork = [], deliveredFiles = [];
const shellCalls = [], shellNetwork = [], heldShell = [], deliveredShell = [];
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
      if (!["file_list", "process_list", "shell_exec"].includes(tool)) {
        requests.push({ kind: "forbidden-tool", tool });
        return send(res, 403, { error: "No host tool calls" });
      }
      requests.push({ kind: "synthetic-tool", tool, path, sessionId: mcpId });
      if (tool === "shell_exec") {
        const fixtures = {
          "fixture-finished-A": { stdout: "A-finished-output\n", stderr: "", exit_code: 0, timed_out: false },
          "fixture-pending-A": { stdout: "A-late-output\n", stderr: "", exit_code: 0, timed_out: false },
          "fixture-current-B": { stdout: "B-current-output\n", stderr: "synthetic-stderr\n", exit_code: 7, timed_out: false },
          "fixture-refused-A": { toolError: "Synthetic command unavailable" },
          "fixture-pending-B": { stdout: "B-late-output\n", stderr: "", exit_code: 0, timed_out: false },
        };
        const command = call.params?.arguments?.command;
        if (!Object.hasOwn(fixtures, command)) {
          requests.push({ kind: "forbidden-synthetic-command" });
          return send(res, 403, { error: "No actual commands accepted" });
        }
        const record = { sequence: shellCalls.length, callId: call.id, sessionId: mcpId, command, cwd: call.params.arguments.cwd, timeoutMs: call.params.arguments.timeout_ms };
        shellCalls.push(record);
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.flushHeaders();
        if (["fixture-pending-A", "fixture-refused-A", "fixture-pending-B"].includes(command)) await new Promise(release => heldShell.push({ record, release }));
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: fixtures[command].toolError ? { isError: true, content: [{ type: "text", text: fixtures[command].toolError }] } : { content: [{ type: "text", text: JSON.stringify(fixtures[command]) }] } }));
      }
      if (tool === "process_list") return send(res, 200, { jsonrpc: "2.0", id: call.id, result: { content: [{ type: "text", text: '{"processes":[]}' }] } });
      const record = { callId: call.id, sessionId: mcpId, path };
      fileCalls.push(record);
      let result;
      try {
        const lexical = jail.resolveLexicalPath(path);
        jail.assertInsideWorkspace(lexical);
        record.lexical = lexical;
        const entries = lexical === "/synthetic/workspace" ? [entry("documents", "directory"), entry(mcpId === otherSessionId ? "b-root.txt" : "a-root.txt")]
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
  profile = await mkdtemp(join(tmpdir(), "computer-shell-session-chrome-"));
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
        else if (rpc.params?.name === "shell_exec") shellNetwork.push({ requestId: m.params.requestId, callId: rpc.id });
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
  if (process.env.COMPUTER_SHELL_SESSION_FAULT === "missing-dom") {
    await navigate("/gui");
    await wait(`document.querySelector('[data-forced-missing-fixture]')`, "intentional missing DOM", 300);
  }
  const shellInput = `document.querySelector('input[autocomplete="off"][spellcheck="false"]')`;
  const shellOutput = `(${shellInput})?.parentElement?.previousElementSibling`;
  async function until(predicate, label) {
    const end = Date.now() + 3000;
    while (!predicate() && Date.now() < end) await delay(20);
    if (!predicate()) throw Error(label);
  }
  async function paint() { await ev("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))"); }
  async function typeCommand(command) {
    await click(shellInput, "focus synthetic command input");
    await ev(`(${shellInput}).select()`);
    await cdp("Input.insertText", { text: command });
    actions.push({ action: "type synthetic text " + command, kind: "keyboard", at: Date.now() });
  }
  async function submit(command) {
    await typeCommand(command);
    const before = shellCalls.length;
    await key("Enter");
    await until(() => shellCalls.length === before + 1, "synthetic command RPC missing");
    return shellCalls.at(-1);
  }
  async function delivered(record) {
    await until(() => networkFinished.has(shellNetwork[record.sequence]?.requestId), "synthetic shell reply not received by browser");
    deliveredShell.push({ ...shellNetwork[record.sequence], sequence: record.sequence, loadingFinished: true });
    await paint();
  }
  async function routerLink(id) {
    await ev(`(()=>{document.getElementById('shell-route')?.remove();const a=document.createElement('a');a.id='shell-route';a.href='/gui/sandbox/${id}';a.textContent='Synthetic route';document.body.append(a)})()`);
    await click(`document.getElementById('shell-route')`, "same-SPA session switch to " + id);
    await wait(`location.pathname.endsWith('/${id}')&&(${filesRoot})?.innerText.includes('${id === otherSessionId ? "b-root.txt" : "a-root.txt"}')`, "actual current-session Viewer");
  }
  await navigate("/gui"); await wait(`document.querySelector('tbody a')`, "session list");
  await click(`document.querySelector('tbody a')`, "open A Viewer");
  await wait(`(${filesRoot})?.innerText.includes('a-root.txt')`, "A current files");
  const initialDocument = await ev("performance.timeOrigin");
  const finished = await submit("fixture-finished-A"); await delivered(finished);
  check("actual client displays A synthetic output before switch", await ev(`(${shellOutput}).innerText.includes('A-finished-output')`), await snap("01-A-finished"));
  const pendingA = await submit("fixture-pending-A"); await typeCommand("A-unsubmitted-draft");
  await routerLink(otherSessionId);
  check("fixture used actual SPA transition, not document reload", await ev("performance.timeOrigin") === initialDocument && requests.filter(x=>x.kind==='dashboard').length === 1, requests.filter(x=>x.kind==='dashboard'));
  check("B output excludes completed A transcript", await ev(`!(${shellOutput}).innerText.includes('A-finished-output')&&!(${shellOutput}).innerText.includes('fixture-pending-A')`), await snap("02-B-before-old-response"));
  check("B input starts without unsubmitted A draft", await ev(`(${shellInput}).value===''`), await ev(`(${shellInput}).value`));
  await key("ArrowUp");
  check("B history cannot recall A command", await ev(`(${shellInput}).value===''`), await ev(`(${shellInput}).value`));
  heldShell.splice(0, 1)[0].release(); await delivered(pendingA);
  check("late A reply cannot appear in B transcript", await ev(`!(${shellOutput}).innerText.includes('A-late-output')&&location.pathname.endsWith('/${otherSessionId}')`), await snap("03-B-after-old-response"));
  check("navigation or history recall sends no B command", shellCalls.length === 2 && shellCalls.every(x=>x.sessionId==='synthetic'), shellCalls);
  const currentB = await submit("fixture-current-B"); await delivered(currentB);
  check("current B preserves legitimate nonzero output and stderr", await ev(`(${shellOutput}).innerText.includes('B-current-output')&&(${shellOutput}).innerText.includes('synthetic-stderr')&&(${shellOutput}).innerText.includes('exit 7')&&!(${shellOutput}).innerText.includes('A-late-output')`), await snap("04-B-current-nonzero"));
  await typeCommand("B-same-session-draft");
  const currentInput = await ev(`(()=>{window.fixtureShellInput=${shellInput};return true})()`);
  await click(`[...(${filesRoot}).querySelectorAll('button')].find(e=>e.textContent.trim().includes('documents'))`, "change cwd within B");
  await wait(`(${cwd}).value==='./documents'&&(${filesRoot}).innerText.includes('draft.md')`, "B cwd change");
  check("same-session cwd change retains B shell instance, draft and output", currentInput && await ev(`window.fixtureShellInput===(${shellInput})&&(${shellInput}).value==='B-same-session-draft'&&(${shellOutput}).innerText.includes('B-current-output')`), await snap("05-B-cwd-draft"));
  await click(shellInput, "recall current B history after cwd change"); await key("ArrowUp");
  check("same-session cwd change preserves current B command history", await ev(`(${shellInput}).value==='fixture-current-B'`), await ev(`(${shellInput}).value`));
  const commandInDirectory = await submit("fixture-current-B"); await delivered(commandInDirectory);
  check("retained same-session receiver sends original B with current cwd", commandInDirectory.sessionId === otherSessionId && commandInDirectory.cwd === "./documents" && commandInDirectory.timeoutMs === 30000, commandInDirectory);
  await routerLink("synthetic");
  check("returning to A starts a clean current receiver without B state", await ev(`!(${shellOutput}).innerText.includes('B-current-output')&&(${shellInput}).value===''`), await snap("06-A-new-instance"));
  const refusedA = await submit("fixture-refused-A"); await routerLink(otherSessionId);
  await typeCommand("B-new-session-draft");
  heldShell.splice(0, 1)[0].release(); await delivered(refusedA);
  check("late A error cannot replace new B draft or add B transcript error", await ev(`(${shellInput}).value==='B-new-session-draft'&&!(${shellOutput}).innerText.includes('Synthetic command unavailable')&&!document.querySelector('[role=alert]')`), await snap("07-A-error-after-B"));
  await key("ArrowUp");
  check("new B receiver does not recall disposed previous B history", await ev(`(${shellInput}).value==='B-new-session-draft'`), await ev(`(${shellInput}).value`));
  const pendingB = await submit("fixture-pending-B");
  await click(`[...document.querySelectorAll('a')].find(e=>e.textContent.includes('Dashboard'))`, "leave pending B receiver");
  await wait(`document.querySelector('tbody a')`, "Dashboard after B");
  heldShell.splice(0, 1)[0].release(); await delivered(pendingB);
  check("disposed receiver reply cannot alter Dashboard or cause page error", await ev(`location.pathname==='/gui'&&!(${shellInput})&&!document.querySelector('[role=alert]')`) && errors.length === 0, await snap("08-disposed-B"));
  await click(`document.querySelector('tbody a')`, "return to clean A receiver");
  await wait(`(${filesRoot}).innerText.includes('a-root.txt')`, "clean A files");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await typeCommand("A-mobile-unsubmitted-draft"); await routerLink(otherSessionId);
  const mobile = await snap("09-mobile-B");
  check("390px session switch clears stale draft with usable focused command input", mobile.viewport.bodyScroll <= mobile.viewport.bodyClient && await ev(`(${shellInput}).value===''&&document.activeElement===(${shellInput})`), mobile);
  check("every fake command response reached browser without replay", deliveredShell.length === shellCalls.length && new Set(deliveredShell.map(x=>x.sequence)).size === shellCalls.length && shellCalls.every(x=>x.timeoutMs===30000), { shellCalls, deliveredShell });
  check("no lifecycle action or native dialog", creates === 0 && dialogs.length === 0, { creates, dialogs });
  check("only strict synthetic endpoints reached", requests.every(x=>!x.kind.startsWith('forbidden')), requests.filter(x=>x.kind.startsWith('forbidden')));
  check("no external request forwarded", intercepted.every(x=>x.allowed), intercepted.filter(x=>!x.allowed));
  check("no uncaught browser error", errors.length === 0, errors);
} catch (e) {
  fatal = e.stack ?? e.message;
} finally {
  for (const x of heldShell.splice(0)) x.release();
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      await bounded(Promise.allSettled([...tasks]), "interceptors");
      if (process.env.COMPUTER_SHELL_SESSION_FAULT === "websocket-close") {
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
const result = { status: fatal ? "HARNESS_ERROR" : failed.length ? "RED" : "PASS", harnessSha256, scope: "Actual built UI Viewer session-target shell state; fake JSON replies only, no native command/tool/process/FS/provider/auth/live execution", dashboardSha256: createHash("sha256").update(html).digest("hex"), browserVersion, chromeStderr, fatal, assertions, failed: failed.map((x) => x.name), actions, actionCount: actions.length, actionCountDefinition: "semantic pointer/key/path/browser actions; bulk text entry is not a physical-keystroke count", creates, fileCalls, deliveredFiles, shellCalls, deliveredShell, dialogs, requests, intercepted, interceptorErrors, errors, snapshots, cleanup };
await writeFile(join(out, "REPORT.json"), JSON.stringify(result, null, 2) + "\n", { mode: 384 });
console.log(JSON.stringify({ status: result.status, failed: result.failed, fatal: result.fatal, actions: actions.length, creates, cleanup, report: join(out, "REPORT.json") }, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
