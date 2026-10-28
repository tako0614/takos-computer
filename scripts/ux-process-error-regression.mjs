import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const repoRoot = resolve(import.meta.dirname, "..");
const dashboardPath = process.env.COMPUTER_PROCESS_ERROR_DASHBOARD_HTML
  ? resolve(process.env.COMPUTER_PROCESS_ERROR_DASHBOARD_HTML)
  : resolve(repoRoot, "packages/computer-hosts/src/gui/app.html");
const dashboard = await readFile(dashboardPath);
const dashboardSha256 = createHash("sha256").update(dashboard).digest("hex");
const evidenceDir = process.env.COMPUTER_PROCESS_ERROR_EVIDENCE_DIR
  ? resolve(process.env.COMPUTER_PROCESS_ERROR_EVIDENCE_DIR)
  : null;
const allowedTools = new Set(["file_list", "shell_exec", "process_list"]);
const modes = new Set(["tool-error", "http-error", "empty-error", "malformed", "invalid-row", "rows", "empty"]);
const refusedProbePath = "/gui/api/unexpected-fixture-route";
const literalIpProbeUrl = "http://203.0.113.42/__fixture/blocked-egress-probe";
const CDP_TIMEOUT_MS = 10_000;
const LOCAL_TIMEOUT_MS = 5_000;
const requests = [];
const browserRequests = [];
const blockedBrowserRequests = [];
const interceptorErrors = [];
const runtimeErrors = [];
const assertions = [];
const snapshots = {};
const pending = new Map();
const interceptorTasks = new Set();
let mode = "tool-error";
let server;
let chrome;
let chromeExit;
let websocket;
let profileDir;
let remotePort;
let fixturePort;
let nextId = 1;
let browserVersion;
let chromeExitResult = null;
let intentionalChromeShutdown = false;
let profileCleanup = "not-created";
let chromeSpawnError = null;

function responseJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}

server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/__fixture/mode" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    if (!modes.has(body.mode)) return responseJson(res, 400, { error: "unknown fixture mode" });
    mode = body.mode;
    return responseJson(res, 200, { mode });
  }
  if (url.pathname === "/gui/api/sandbox-session/synthetic" && req.method === "GET") {
    requests.push({ kind: "session-status", method: req.method });
    return responseJson(res, 200, {
      sessionId: "synthetic",
      spaceId: "fixture",
      userId: "fixture",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  }
  if (url.pathname === "/gui/api/sandbox-session/synthetic/mcp" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const call = JSON.parse(raw || "{}");
    const tool = call?.params?.name;
    requests.push({ kind: "tool-call", tool, mode: tool === "process_list" ? mode : undefined });
    if (!allowedTools.has(tool)) return responseJson(res, 403, { error: "fixture refused unexpected tool" });
    if (tool === "process_kill") return responseJson(res, 403, { error: "fixture forbids process_kill" });
    let result;
    if (tool === "file_list") {
      result = { content: [{ type: "text", text: JSON.stringify({ entries: [] }) }] };
    } else if (tool === "shell_exec") {
      result = { content: [{ type: "text", text: JSON.stringify({ stdout: "", stderr: "", exit_code: 0, timed_out: false }) }] };
    } else if (mode === "tool-error") {
      result = { isError: true, content: [{ type: "text", text: "Synthetic <b>process list</b> failure" }] };
    } else if (mode === "http-error") {
      return responseJson(res, 503, { error: "Synthetic MCP HTTP failure" });
    } else if (mode === "empty-error") {
      result = { isError: true, content: [{ type: "text", text: "" }] };
    } else if (mode === "malformed") {
      result = { content: [{ type: "text", text: JSON.stringify({}) }] };
    } else if (mode === "invalid-row") {
      result = { content: [{ type: "text", text: JSON.stringify({ processes: [null] }) }] };
    } else if (mode === "rows") {
      result = {
        content: [{ type: "text", text: JSON.stringify({ processes: [{ user: "fixture", pid: 424242, cpu: "1", mem: "2", command: "synthetic-worker" }] }) }],
      };
    } else {
      result = { content: [{ type: "text", text: JSON.stringify({ processes: [] }) }] };
    }
    return responseJson(res, 200, { jsonrpc: "2.0", result, id: call.id ?? null });
  }
  if (url.pathname === "/gui/sandbox/synthetic" && req.method === "GET") {
    requests.push({ kind: "dashboard", method: req.method, path: url.pathname });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(dashboard);
    return;
  }
  if (url.pathname === "/favicon.ico" && req.method === "GET") {
    requests.push({ kind: "local-static-resource", method: req.method, path: url.pathname });
    res.writeHead(204, { "Cache-Control": "no-store" });
    return res.end();
  }
  requests.push({ kind: "refused-route", method: req.method, path: url.pathname });
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("synthetic fixture only");
});

function listen(target, host) {
  return new Promise((resolvePromise, reject) => {
    target.once("error", reject);
    target.listen(0, host, () => resolvePromise(target.address().port));
  });
}

async function reservePort() {
  const probe = net.createServer();
  const port = await listen(probe, "127.0.0.1");
  await new Promise((resolvePromise) => probe.close(resolvePromise));
  return port;
}

function cdp(method, params = {}) {
  const id = nextId++;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP ${method} timed out`));
    }, CDP_TIMEOUT_MS);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolvePromise(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    try {
      websocket.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      pending.delete(id)?.reject(error);
    }
  });
}

function bounded(promise, label, timeoutMs = LOCAL_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function rejectPending(error) {
  for (const callbacks of pending.values()) callbacks.reject(error);
  pending.clear();
}

async function settleInterceptors() {
  const end = Date.now() + CDP_TIMEOUT_MS + 1000;
  while (interceptorTasks.size > 0) {
    await bounded(
      Promise.allSettled([...interceptorTasks]),
      "browser request interception settlement",
      Math.max(1, end - Date.now()),
    );
  }
}

async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const message = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
    throw new Error(`browser evaluation failed: ${message}`);
  }
  return result.result?.value;
}

async function sample() {
  return evaluate(`(() => {
    const heading = [...document.querySelectorAll('span')].find((node) => node.textContent.trim() === 'Processes');
    const root = heading?.parentElement?.parentElement;
    const card = root?.querySelector('.card');
    const alerts = [...document.querySelectorAll('[role="alert"]')];
    return {
      processPanel: card?.innerText ?? null,
      alertTexts: alerts.map((node) => node.innerText),
      alertHasBoldElement: alerts.some((node) => !!node.querySelector('b')),
      refreshAvailable: !!root?.querySelector('button'),
      appRendered: !!document.querySelector('#app')?.children.length,
      bodyText: document.body?.innerText ?? "",
    };
  })()`);
}

async function waitFor(predicate, timeoutMs = 2500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await sample();
    if (predicate(value)) return value;
    await delay(50);
  }
  return sample();
}

async function waitForProcessListMode(expected, previousCount = 0, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const count = requests.filter((item) => item.kind === "tool-call" && item.tool === "process_list" && item.mode === expected).length;
    if (count > previousCount) return true;
    await delay(25);
  }
  return false;
}

async function setMode(next) {
  const response = await fetch(`http://127.0.0.1:${fixturePort}/__fixture/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: next }),
    signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
  });
  assert.equal(response.status, 200, `fixture rejected mode ${next}`);
}

async function refresh() {
  return evaluate(`(() => {
    const heading = [...document.querySelectorAll('span')].find((node) => node.textContent.trim() === 'Processes');
    const button = heading?.parentElement?.parentElement?.querySelector('button');
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

function check(name, passed, actual) {
  assertions.push({ name, passed: !!passed, actual });
}

function localizedAlert(text, expected) {
  return (text.startsWith("Error: ") || text.startsWith("エラー: ")) && text.includes(expected);
}

async function capture(name, snapshot) {
  snapshots[name] = { ...snapshot, runtimeErrors: runtimeErrors.slice() };
  if (!evidenceDir) return;
  const image = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const imagePath = resolve(evidenceDir, `${name}.png`);
  await writeFile(imagePath, Buffer.from(image.data, "base64"), { mode: 0o600 });
  snapshots[name].screenshot = imagePath;
}

async function exerciseFailure(prefix, expectedText) {
  const initial = await waitFor((value) => (value.processPanel !== null && value.processPanel !== "Loading...") || value.alertTexts.length > 0);
  check(`${prefix}: failure renders a localized visible alert`, initial.alertTexts.some((text) => localizedAlert(text, expectedText)), initial);
  check(`${prefix}: panel is not permanently loading`, initial.processPanel !== "Loading...", initial.processPanel);
  check(`${prefix}: refresh remains available`, initial.refreshAvailable, initial.refreshAvailable);
  check(`${prefix}: dashboard remains rendered`, initial.appRendered, initial.appRendered);
  check(`${prefix}: no uncaught runtime exception`, runtimeErrors.length === 0, runtimeErrors.slice());
  check(`${prefix}: backend error is rendered as text`, !initial.alertHasBoldElement, initial.alertHasBoldElement);
  await capture(`${prefix}-initial-error`, initial);

  const failureMode = prefix === "tool"
    ? "tool-error"
    : prefix === "http"
    ? "http-error"
    : prefix === "empty-error"
    ? "empty-error"
    : prefix === "invalid-row"
    ? "invalid-row"
    : "malformed";
  await setMode(failureMode);
  const clicked = await refresh();
  await delay(350);
  const repeated = await sample();
  check(`${prefix}: repeated failure can be refreshed`, clicked, clicked);
  check(`${prefix}: repeated failure keeps its alert`, repeated.alertTexts.some((text) => localizedAlert(text, expectedText)), repeated);
  check(`${prefix}: repeated failure leaves refresh available`, repeated.refreshAvailable, repeated.refreshAvailable);
  check(`${prefix}: repeated failure keeps dashboard rendered`, repeated.appRendered, repeated.appRendered);
  check(`${prefix}: repeated failure has no uncaught exception`, runtimeErrors.length === 0, runtimeErrors.slice());
  await capture(`${prefix}-repeated-error`, repeated);

  await setMode("rows");
  const successClicked = await refresh();
  const rows = await waitFor((value) => (value.processPanel ?? "").includes("424242"));
  check(`${prefix}: refresh returns synthetic rows`, successClicked && (rows.processPanel ?? "").includes("synthetic-worker") && (rows.processPanel ?? "").includes("1% / 2%"), rows);
  check(`${prefix}: success clears the alert`, rows.alertTexts.length === 0, rows.alertTexts);
  check(`${prefix}: success path has no uncaught exception`, runtimeErrors.length === 0, runtimeErrors.slice());
  await capture(`${prefix}-success-rows`, rows);

  await setMode("empty");
  const emptyClicked = await refresh();
  const empty = await waitFor((value) => value.processPanel === "No processes");
  check(`${prefix}: successful empty remains distinct`, emptyClicked && empty.processPanel === "No processes", empty);
  check(`${prefix}: empty result clears the alert`, empty.alertTexts.length === 0, empty.alertTexts);
  await capture(`${prefix}-success-empty`, empty);
}

function report(extra = {}) {
  const nonLocalBrowserRequests = browserRequests.filter((value) => {
    try {
      return !["127.0.0.1", "localhost"].includes(new URL(value).hostname);
    } catch {
      return !value.startsWith("data:");
    }
  });
  const toolCalls = requests.filter((item) => item.kind === "tool-call");
  const unknownToolCalls = toolCalls.filter((item) => !allowedTools.has(item.tool));
  const processKillCalls = toolCalls.filter((item) => item.tool === "process_kill");
  return {
    title: "Synthetic ProcessList error and recovery regression",
    dashboardPath,
    dashboardSha256,
    fixture: "private loopback HTTP/MCP; synthetic status, shell, files, and processes only",
    assertions,
    snapshots,
    runtimeErrors,
    requests,
    browserRequests,
    blockedBrowserRequests,
    interceptorErrors,
    nonLocalBrowserRequests,
    processKillCalls: processKillCalls.length,
    unknownToolCalls: unknownToolCalls.length,
    chromePid: chrome?.pid ?? null,
    profileCleanup,
    ...extra,
  };
}

async function persist(value, filename = "report.json") {
  if (!evidenceDir) return;
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  const path = resolve(evidenceDir, filename);
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
}

let fatalError = null;
let serverClose = null;
try {
  fixturePort = await listen(server, "127.0.0.1");
  remotePort = await reservePort();
  const profileRoot = evidenceDir ?? process.env.TMPDIR ?? "/root/dev/tmp";
  await mkdir(profileRoot, { recursive: true, mode: 0o700 });
  profileDir = await mkdtemp(join(profileRoot, "chrome-profile-owned-"));
  chrome = spawn("google-chrome", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${remotePort}`,
    "--remote-allow-origins=*",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  chromeExit = new Promise((resolvePromise) => {
    chrome.once("exit", (code, signal) => resolvePromise({ code, signal }));
    chrome.once("error", (error) => {
      chromeSpawnError = error;
      resolvePromise({ error: error.message });
    });
  });
  const version = await (async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${remotePort}/json/version`, {
          signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
        });
        if (response.ok) return response.json();
      } catch {}
      if (chromeSpawnError) throw chromeSpawnError;
      if (chrome.exitCode !== null) throw new Error(`private Chrome exited before startup: ${chrome.exitCode}`);
      await delay(100);
    }
    throw new Error("private Chrome DevTools did not start");
  })();
  browserVersion = (await version).Browser;
  const target = await (await fetch(`http://127.0.0.1:${remotePort}/json/new?about:blank`, {
    method: "PUT",
    signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
  })).json();
  websocket = new WebSocket(target.webSocketDebuggerUrl);
  await bounded(new Promise((resolvePromise, reject) => {
    websocket.addEventListener("open", resolvePromise, { once: true });
    websocket.addEventListener("error", reject, { once: true });
  }), "private Chrome DevTools WebSocket open");
  websocket.addEventListener("close", () => rejectPending(new Error("private Chrome DevTools WebSocket closed")));
  websocket.addEventListener("error", () => rejectPending(new Error("private Chrome DevTools WebSocket failed")));
  websocket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const callbacks = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callbacks.reject(new Error(message.error.message));
      else callbacks.resolve(message.result ?? {});
    } else if (message.method === "Runtime.exceptionThrown") {
      runtimeErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text ?? "unknown exception");
    } else if (message.method === "Network.requestWillBeSent") {
      browserRequests.push(message.params.request.url);
    } else if (message.method === "Fetch.requestPaused") {
      const request = message.params.request;
      let origin = null;
      try {
        origin = new URL(request.url).origin;
      } catch {}
      const allowed = origin === `http://127.0.0.1:${fixturePort}`;
      if (!allowed) blockedBrowserRequests.push({ origin, probe: request.url === literalIpProbeUrl });
      const task = cdp(
        allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
        allowed
          ? { requestId: message.params.requestId }
          : { requestId: message.params.requestId, errorReason: "BlockedByClient" },
      )
        .catch((error) => interceptorErrors.push(error.message))
        .finally(() => interceptorTasks.delete(task));
      interceptorTasks.add(task);
    }
  });
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Network.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  await cdp("Page.navigate", { url: `http://127.0.0.1:${fixturePort}/gui/sandbox/synthetic` });
  await exerciseFailure("tool", "Synthetic");

  await setMode("http-error");
  const previousHttpErrorCalls = requests.filter((item) => item.kind === "tool-call" && item.tool === "process_list" && item.mode === "http-error").length;
  await cdp("Page.navigate", { url: `http://127.0.0.1:${fixturePort}/gui/sandbox/synthetic` });
  const httpInitialRequestObserved = await waitForProcessListMode("http-error", previousHttpErrorCalls);
  check("http: initial failing request reached the synthetic fixture", httpInitialRequestObserved, requests.slice(-5));
  await delay(100);
  await exerciseFailure("http", "MCP HTTP 503");

  await setMode("malformed");
  const previousMalformedCalls = requests.filter((item) => item.kind === "tool-call" && item.tool === "process_list" && item.mode === "malformed").length;
  await cdp("Page.navigate", { url: `http://127.0.0.1:${fixturePort}/gui/sandbox/synthetic` });
  const malformedInitialRequestObserved = await waitForProcessListMode("malformed", previousMalformedCalls);
  check("malformed: initial successful payload reached the synthetic fixture", malformedInitialRequestObserved, requests.slice(-5));
  await delay(100);
  await exerciseFailure("malformed", "Invalid process list response");

  await setMode("empty-error");
  const previousEmptyErrorCalls = requests.filter((item) => item.kind === "tool-call" && item.tool === "process_list" && item.mode === "empty-error").length;
  await cdp("Page.navigate", { url: `http://127.0.0.1:${fixturePort}/gui/sandbox/synthetic` });
  const emptyErrorInitialRequestObserved = await waitForProcessListMode("empty-error", previousEmptyErrorCalls);
  check("empty-error: initial empty tool error reached the synthetic fixture", emptyErrorInitialRequestObserved, requests.slice(-5));
  await delay(100);
  await exerciseFailure("empty-error", "Unknown process list error");

  await setMode("invalid-row");
  const previousInvalidRowCalls = requests.filter((item) => item.kind === "tool-call" && item.tool === "process_list" && item.mode === "invalid-row").length;
  await cdp("Page.navigate", { url: `http://127.0.0.1:${fixturePort}/gui/sandbox/synthetic` });
  const invalidRowInitialRequestObserved = await waitForProcessListMode("invalid-row", previousInvalidRowCalls);
  check("invalid-row: initial malformed row reached the synthetic fixture", invalidRowInitialRequestObserved, requests.slice(-5));
  await delay(100);
  await exerciseFailure("invalid-row", "Invalid process list response");

  const refusedProbe = await fetch(`http://127.0.0.1:${fixturePort}${refusedProbePath}`, {
    signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
  });
  check("fixture refuses an unexpected dashboard API route", refusedProbe.status === 404, refusedProbe.status);
  const refusedMethodProbe = await fetch(`http://127.0.0.1:${fixturePort}/gui/sandbox/synthetic`, {
    method: "POST",
    signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
  });
  check("fixture refuses an unexpected dashboard method", refusedMethodProbe.status === 404, refusedMethodProbe.status);
  const blockedProbe = await evaluate(`fetch(${JSON.stringify(literalIpProbeUrl)}).then(() => "unexpected success", () => "blocked")`);
  check("literal-IP browser egress is blocked before network", blockedProbe === "blocked" && blockedBrowserRequests.some((item) => item.probe), { blockedProbe, blockedBrowserRequests });
  await settleInterceptors();

  const preliminary = report({ browserVersion, status: "pending-cleanup" });
  const unexpectedNonLocalRequests = preliminary.nonLocalBrowserRequests.filter((url) => url !== literalIpProbeUrl);
  check("all unprompted browser requests stay local", unexpectedNonLocalRequests.length === 0, unexpectedNonLocalRequests);
  check("browser interception completed without errors", interceptorErrors.length === 0, interceptorErrors.slice());
  check("fixture refuses no process authority calls", preliminary.processKillCalls === 0, preliminary.processKillCalls);
  check("fixture receives no unexpected tool calls", preliminary.unknownToolCalls === 0, preliminary.unknownToolCalls);
  const unexpectedRoutes = requests.filter((item) => item.kind === "refused-route" && !(item.path === refusedProbePath && item.method === "GET") && !(item.path === "/gui/sandbox/synthetic" && item.method === "POST"));
  check("fixture receives no other unexpected HTTP routes", unexpectedRoutes.length === 0, unexpectedRoutes);
} catch (error) {
  fatalError = error;
} finally {
  const cleanupFailures = [];
  if (websocket?.readyState === WebSocket.OPEN) {
    try {
      await settleInterceptors();
    } catch (error) {
      cleanupFailures.push(`browser request interception settlement: ${error.message}`);
    }
    try {
      rejectPending(new Error("private Chrome DevTools WebSocket closing"));
      const closed = new Promise((resolvePromise) => websocket.addEventListener("close", resolvePromise, { once: true }));
      websocket.close();
      await bounded(closed, "private Chrome DevTools WebSocket close", 3000);
    } catch (error) {
      cleanupFailures.push(`WebSocket close: ${error.message}`);
    }
  } else {
    rejectPending(new Error("private Chrome DevTools WebSocket unavailable"));
  }
  if (interceptorErrors.length) cleanupFailures.push(`browser request interception: ${interceptorErrors.join("; ")}`);
  if (chrome) {
    try {
      const wasRunning = chrome.exitCode === null && !chromeSpawnError;
      if (wasRunning) {
        intentionalChromeShutdown = true;
        if (!chrome.kill("SIGTERM")) cleanupFailures.push("private Chrome refused SIGTERM");
      }
      chromeExitResult = await Promise.race([chromeExit, delay(3000).then(() => null)]);
      if (!chromeExitResult && wasRunning) {
        if (!chrome.kill("SIGKILL")) cleanupFailures.push("private Chrome refused SIGKILL");
        chromeExitResult = await Promise.race([chromeExit, delay(3000).then(() => null)]);
      }
      const shutdownObserved = wasRunning && intentionalChromeShutdown && chromeExitResult !== null;
      assertions.push({ name: "private Chrome shutdown was explicitly awaited", passed: shutdownObserved, actual: { wasRunning, intentionalChromeShutdown, exit: chromeExitResult } });
      if (!shutdownObserved) cleanupFailures.push("private Chrome did not exit through awaited harness cleanup");
    } catch (error) {
      cleanupFailures.push(`private Chrome cleanup: ${error.message}`);
    }
  }
  if (server?.listening) {
    try {
      await bounded(new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())), "synthetic HTTP fixture closure", 3000);
      serverClose = "closed-and-awaited";
      assertions.push({ name: "synthetic HTTP fixture closure was awaited", passed: true, actual: serverClose });
    } catch (error) {
      cleanupFailures.push(`fixture HTTP server cleanup: ${error.message}`);
      server.closeAllConnections();
    }
  } else if (server) {
    cleanupFailures.push("synthetic HTTP fixture stopped before awaited cleanup");
  }
  if (profileDir) {
    try {
      await bounded(rm(profileDir, { recursive: true, force: true }), "owned private Chrome profile removal", 3000);
      profileCleanup = "removed";
    } catch (error) {
      profileCleanup = "failed";
      cleanupFailures.push(`private Chrome profile cleanup: ${error.message}`);
    }
  }
  for (const failure of cleanupFailures) assertions.push({ name: "owned fixture and Chrome cleanup completed", passed: false, actual: failure });
  if (cleanupFailures.length) fatalError ??= new Error(cleanupFailures.join("; "));
}

const result = report({
  status: fatalError || assertions.some((item) => !item.passed) ? "FAIL" : "PASS",
  browserVersion,
  serverClose,
  fatalError: fatalError?.stack ?? null,
});
await persist(result);
console.log(JSON.stringify({ status: result.status, failed: assertions.filter((item) => !item.passed).map((item) => item.name), processKillCalls: result.processKillCalls, unknownToolCalls: result.unknownToolCalls, nonLocalBrowserRequests: result.nonLocalBrowserRequests.length, report: evidenceDir ? resolve(evidenceDir, "report.json") : null }, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
