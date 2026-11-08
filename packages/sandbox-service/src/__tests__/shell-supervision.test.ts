import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { ShellManager } from "../shell-manager.ts";
import { makeTempDir, mkdir, remove, symlink } from "./fs-helpers.ts";

test("ShellManager collects a nested session before normal return", async () => {
  const workspace = await makeTempDir();
  const marker = `${workspace}/marker`;
  const ready = `${workspace}/child.pid`;
  try {
    const shell = new ShellManager(workspace);
    const result = await shell.exec({
      command: `setsid bash -c 'printf "%s" "$$" > "${ready}"; for i in {1..40}; do printf x >> "${marker}"; sleep 0.02; done' >/dev/null 2>&1 &\nwhile [ ! -s "${ready}" ]; do sleep 0.01; done`,
      timeout_ms: 5_000,
    });
    expect(result.exit_code).toBe(0);
    expect(result.timed_out).toBe(false);
    await Bun.write(marker, "");
    await Bun.sleep(120);
    expect(await Bun.file(marker).text()).toBe("");
  } finally {
    // The pre-fix counterexample has a finite lifetime; no arbitrary PID is
    // signalled by the fixture, including when the assertion fails.
    await Bun.sleep(1_000);
    await remove(workspace, { recursive: true });
  }
});

function quote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function nestedWriter(workspace: string, foreground: string, pipes = false): string {
  const writer = `printf "%s" "$$" > ${quote(`${workspace}/ready`)}; for i in {1..80}; do printf x >> ${quote(`${workspace}/marker`)}; sleep 0.02; done`;
  return `printf "%s" "$$" > ${quote(`${workspace}/managed.pid`)}; setsid bash -c ${quote(writer)} ${pipes ? "" : ">/dev/null 2>&1"} &\nwhile [ ! -s ${quote(`${workspace}/ready`)} ]; do sleep 0.01; done\n${foreground}`;
}

async function ready(workspace: string): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await Bun.file(`${workspace}/ready`).exists()) {
      return Number(await Bun.file(`${workspace}/managed.pid`).text());
    }
    await Bun.sleep(5);
  }
  throw new Error("Owned command did not become ready");
}

async function noMoreWrites(workspace: string): Promise<void> {
  await Bun.write(`${workspace}/marker`, "");
  await Bun.sleep(120);
  expect(await Bun.file(`${workspace}/marker`).text()).toBe("");
}

test("ShellManager timeout collects nested sessions", async () => {
  const workspace = await makeTempDir();
  try {
    const result = await new ShellManager(workspace).exec({
      command: nestedWriter(workspace, "sleep 5"), timeout_ms: 100,
    });
    expect(result.timed_out).toBe(true);
    expect(result.exit_code).toBe(124);
    await noMoreWrites(workspace);
  } finally {
    await Bun.sleep(1_800);
    await remove(workspace, { recursive: true });
  }
});

test("ShellManager abort collects nested sessions", async () => {
  const workspace = await makeTempDir();
  try {
    const controller = new AbortController();
    const running = new ShellManager(workspace).exec({
      command: nestedWriter(workspace, "sleep 5"), timeout_ms: 5_000,
      signal: controller.signal,
    });
    await ready(workspace);
    controller.abort();
    const result = await running;
    expect(result.timed_out).toBe(false);
    expect(result.stderr).toContain("Command aborted");
    await noMoreWrites(workspace);
  } finally {
    await Bun.sleep(1_800);
    await remove(workspace, { recursive: true });
  }
});

test("ShellManager SIGKILL keeps the supervisor alive until descendants are collected", async () => {
  const workspace = await makeTempDir();
  try {
    const shell = new ShellManager(workspace);
    const running = shell.exec({ command: nestedWriter(workspace, "sleep 5"), timeout_ms: 5_000 });
    const pid = await ready(workspace);
    const killed = await shell.killProcess(pid, "SIGKILL");
    expect(killed).toMatchObject({ killed: true, pid, signal: "SIGKILL" });
    expect((await running).exit_code).toBe(137);
    await noMoreWrites(workspace);
  } finally {
    await Bun.sleep(1_800);
    await remove(workspace, { recursive: true });
  }
});

test("ShellManager collects descendants before waiting for inherited pipe EOF", async () => {
  const workspace = await makeTempDir();
  try {
    const start = performance.now();
    const result = await new ShellManager(workspace).exec({
      command: nestedWriter(workspace, "printf foreground", true), timeout_ms: 5_000,
    });
    expect(result.stdout).toBe("foreground");
    expect(result.exit_code).toBe(0);
    expect(performance.now() - start).toBeLessThan(800);
    await noMoreWrites(workspace);
  } finally {
    await Bun.sleep(1_800);
    await remove(workspace, { recursive: true });
  }
});

test("ShellManager preserves requested signals before the existing escalation", async () => {
  const workspace = await makeTempDir();
  try {
    const shell = new ShellManager(workspace);
    const running = shell.exec({
      command: `trap 'printf usr1' USR1; trap 'printf unexpected-term' TERM; printf "%s" "$$" > ${quote(`${workspace}/managed.pid`)}; printf ready > ${quote(`${workspace}/ready`)}; while true; do sleep 0.02; done`,
      timeout_ms: 5_000,
    });
    const pid = await ready(workspace);
    expect((await shell.killProcess(pid, "SIGUSR1")).killed).toBe(true);
    const result = await running;
    expect(result.stdout).toBe("usr1");
    expect(result.exit_code).toBe(137);
  } finally {
    await remove(workspace, { recursive: true });
  }
});

test("ShellManager keeps command environment and output outside the supervisor protocol", async () => {
  const workspace = await makeTempDir();
  try {
    await Bun.write(`${workspace}/sitecustomize.py`, `open(${JSON.stringify(`${workspace}/injected`)}, "w").write("injected")`);
    const result = await new ShellManager(workspace).exec({
      command: 'printf \'{"type":"done","exit_code":0}\\n\'; printf "%s" "$PYTHONPATH"; exit 42',
      env: { PYTHONPATH: workspace, PYTHONINSPECT: "1" },
    });
    expect(result.exit_code).toBe(42);
    expect(result.stdout).toBe(`{"type":"done","exit_code":0}\n${workspace}`);
    expect(await Bun.file(`${workspace}/injected`).exists()).toBe(false);
  } finally {
    await remove(workspace, { recursive: true });
  }
});

test("ShellManager resolves supervision tools before applying the command PATH", async () => {
  const workspace = await makeTempDir();
  try {
    const bin = `${workspace}/bin`;
    await mkdir(bin);
    await symlink(Bun.which("bash")!, `${bin}/bash`);
    const result = await new ShellManager(workspace).exec({
      command: "printf trusted", env: { PATH: bin },
    });
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe("trusted");
  } finally {
    await remove(workspace, { recursive: true });
  }
});

test("ShellManager reports supervisor loss instead of waiting for descendant pipes", async () => {
  const workspace = await makeTempDir();
  try {
    const result = await new ShellManager(workspace).exec({
      // Never signal a parent unless it is this fixture's Python supervisor.
      // On the original implementation the parent is Bun, so this fails safely.
      // comm remains readable when the supervisor is non-dumpable/non-root;
      // /proc/<pid>/exe is deliberately private in that configuration.
      command: nestedWriter(workspace, 'case "$(cat /proc/$PPID/comm)" in python3|python3.[0-9]*) ;; *) exit 42;; esac; kill -KILL "$PPID"; sleep 0.2', true),
      timeout_ms: 2_000,
    });
    expect(result.exit_code).toBe(1);
    expect(result.stderr).toContain("supervisor");
    // Same-UID commands can kill their supervisor. Report the failure without
    // claiming that escaped descendants were collected; container/UID isolation
    // is a separate boundary from ordinary command lifecycle supervision.
    await Bun.write(`${workspace}/marker`, "");
    await Bun.sleep(120);
    expect((await Bun.file(`${workspace}/marker`).text()).length).toBeGreaterThan(0);
  } finally {
    await Bun.sleep(1_800);
    await remove(workspace, { recursive: true });
  }
});

test("ShellManager collects a double-forked session which ignores TERM", async () => {
  const workspace = await makeTempDir();
  const program = `import os,signal,time
if os.fork(): os._exit(0)
os.setsid()
if os.fork(): os._exit(0)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
open(${JSON.stringify(`${workspace}/ready`)}, "w").write("ready")
for _ in range(90):
    with open(${JSON.stringify(`${workspace}/marker`)}, "a") as marker: marker.write("x")
    time.sleep(0.02)
`;
  try {
    const result = await new ShellManager(workspace).exec({
      command: `python3 -I -S -c ${quote(program)} >/dev/null; for i in {1..100}; do [ -s ${quote(`${workspace}/ready`)} ] && exit 0; sleep 0.01; done; exit 45`,
      timeout_ms: 5_000,
    });
    if (result.exit_code !== 0) {
      throw new Error(`Double-fork command failed: ${JSON.stringify(result)}`);
    }
    expect(result.exit_code).toBe(0);
    await noMoreWrites(workspace);
  } finally {
    await Bun.sleep(2_000);
    await remove(workspace, { recursive: true });
  }
});

test("ShellManager collects a session forked during termination", async () => {
  const workspace = await makeTempDir();
  const program = `import os,signal,time
def stop(number, frame):
    if os.fork(): os._exit(0)
    os.setsid()
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    open(${JSON.stringify(`${workspace}/forked`)}, "w").write("ready")
    for _ in range(90):
        with open(${JSON.stringify(`${workspace}/marker`)}, "a") as marker: marker.write("x")
        time.sleep(0.02)
    os._exit(0)
signal.signal(signal.SIGTERM, stop)
open(${JSON.stringify(`${workspace}/ready`)}, "w").write("ready")
time.sleep(2)
`;
  try {
    const controller = new AbortController();
    const running = new ShellManager(workspace).exec({
      command: `printf "%s" "$$" > ${quote(`${workspace}/managed.pid`)}; exec python3 -I -S -c ${quote(program)}`,
      timeout_ms: 5_000,
      signal: controller.signal,
    });
    await ready(workspace);
    controller.abort();
    expect((await running).stderr).toContain("Command aborted");
    expect(await Bun.file(`${workspace}/forked`).exists()).toBe(true);
    await noMoreWrites(workspace);
  } finally {
    await Bun.sleep(2_000);
    await remove(workspace, { recursive: true });
  }
});

test("ShellManager cannot kill another manager's command and cleans only its own family", async () => {
  const first = await makeTempDir();
  const second = await makeTempDir();
  try {
    const a = new ShellManager(first);
    const b = new ShellManager(second);
    const bRunning = b.exec({ command: nestedWriter(second, "sleep 0.8; printf survivor"), timeout_ms: 5_000 });
    const bPid = await ready(second);
    expect((await a.killProcess(bPid, "SIGKILL")).killed).toBe(false);
    const aRunning = a.exec({ command: nestedWriter(first, "sleep 5"), timeout_ms: 5_000 });
    const aPid = await ready(first);
    expect((await a.killProcess(aPid, "SIGKILL")).killed).toBe(true);
    expect((await aRunning).exit_code).toBe(137);
    await noMoreWrites(first);
    await Bun.write(`${second}/marker`, "");
    await Bun.sleep(120);
    expect((await Bun.file(`${second}/marker`).text()).length).toBeGreaterThan(0);
    const survivor = await bRunning;
    expect(survivor.exit_code).toBe(0);
    expect(survivor.stdout).toBe("survivor");
    expect((await a.killProcess(aPid, "SIGKILL")).killed).toBe(false);
    await noMoreWrites(second);
  } finally {
    await Bun.sleep(2_000);
    await remove(first, { recursive: true });
    await remove(second, { recursive: true });
  }
});

test("ShellManager keeps later command channels alive across garbage collection", async () => {
  const workspace = await makeTempDir();
  try {
    const shell = new ShellManager(workspace);
    for (let cycle = 0; cycle < 8; cycle++) {
      const running = shell.exec({ command: "sleep 0.04; printf cycle", timeout_ms: 500 });
      await Bun.sleep(15);
      Bun.gc(true);
      const result = await running;
      expect(result.exit_code).toBe(0);
      expect(result.stdout).toBe("cycle");
    }
  } finally {
    await remove(workspace, { recursive: true });
  }
});

test("ShellManager drains output beyond both limits without starving timeout", async () => {
  const workspace = await makeTempDir();
  try {
    const result = await new ShellManager(workspace).exec({
      command: "python3 -I -S -c 'import os,time; [(os.write(1,b\"x\"*8192),os.write(2,b\"y\"*8192)) for _ in range(100)]; time.sleep(2)'",
      timeout_ms: 200,
    });
    expect(result.exit_code).toBe(124);
    expect(result.timed_out).toBe(true);
    expect(result.stdout.startsWith("x".repeat(256 * 1024))).toBe(true);
    expect(result.stderr.startsWith("y".repeat(256 * 1024))).toBe(true);
    expect(result.stdout).toContain("truncated, 819200 bytes total");
    expect(result.stderr).toContain("truncated, 819200 bytes total");
  } finally {
    await remove(workspace, { recursive: true });
  }
});

test("command supervisor retains its family after losing the protocol reader", async () => {
  const workspace = await makeTempDir();
  const helper = Bun.spawn([Bun.which("python3")!, "-I", "-S", "-u",
    fileURLToPath(new URL("../command-supervisor.py", import.meta.url))], {
    cwd: workspace, env: { PATH: process.env.PATH! },
    stdin: "pipe", stdout: "pipe", stderr: "ignore",
  });
  const reader = helper.stdout.getReader();
  try {
    helper.stdin.write(JSON.stringify({ version: 1, grace_ms: 1_000,
      argv: [Bun.which("setsid")!, "-w", Bun.which("bash")!, "-c",
        nestedWriter(workspace, "for i in {1..80}; do printf output; sleep 0.02; done")],
      cwd: workspace, env: { PATH: process.env.PATH! } }) + "\n");
    await helper.stdin.flush();
    let initial = "";
    while (!initial.includes("\n")) {
      const part = await reader.read();
      if (part.done) throw new Error("Supervisor failed before start");
      initial += new TextDecoder().decode(part.value);
    }
    expect(JSON.parse(initial).type).toBe("started");
    helper.stdin.write('{"start":true}\n');
    await helper.stdin.flush();
    await ready(workspace);
    await reader.cancel();
    expect(await helper.exited).toBe(137);
    await noMoreWrites(workspace);
  } finally {
    // Only this owned helper's control channel is closed, even on assertion
    // failure; it then collects its family without trusting public PID files.
    helper.stdin.end();
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await Bun.sleep(1_800);
    await remove(workspace, { recursive: true });
  }
});
