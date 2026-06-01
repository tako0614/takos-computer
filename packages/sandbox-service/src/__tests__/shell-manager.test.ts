import { expect, test } from "bun:test";
import { env } from "node:process";
import { ShellManager } from "../shell-manager.ts";
import { makeTempDir, remove, symlink } from "./fs-helpers.ts";

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
}

test("ShellManager: exec simple command returns stdout", async () => {
  const tmpDir = await makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({ command: 'echo "hello"' });
    expect(result.stdout.trim()).toEqual("hello");
    expect(result.stderr).toEqual("");
    expect(result.exit_code).toEqual(0);
    expect(result.timed_out).toEqual(false);
  } finally {
    await remove(tmpDir, { recursive: true });
  }
});

test("ShellManager: exec with custom cwd", async () => {
  const tmpDir = await makeTempDir();
  try {
    const shell = new ShellManager("/tmp");
    const result = await shell.exec({ command: "pwd", cwd: tmpDir });
    expect(result.stdout.trim()).toEqual(tmpDir);
    expect(result.exit_code).toEqual(0);
  } finally {
    await remove(tmpDir, { recursive: true });
  }
});

test("ShellManager: exec rejects cwd outside workspace", async () => {
  const workspaceDir = await makeTempDir();
  const outsideDir = await makeTempDir();
  try {
    const shell = new ShellManager(workspaceDir);
    const result = await shell.exec({ command: "pwd", cwd: outsideDir });

    expect(result.stdout).toEqual("");
    expect(result.stderr.includes("cwd is outside workspace")).toBeTruthy();
    expect(result.exit_code).toEqual(1);
  } finally {
    await remove(workspaceDir, { recursive: true });
    await remove(outsideDir, { recursive: true });
  }
});

test("ShellManager: exec rejects symlink cwd escaping workspace", async () => {
  const workspaceDir = await makeTempDir();
  const outsideDir = await makeTempDir();
  const linkPath = `${workspaceDir}/escape`;
  try {
    await symlink(outsideDir, linkPath, { type: "dir" });

    const shell = new ShellManager(workspaceDir);
    const result = await shell.exec({ command: "pwd", cwd: linkPath });

    expect(result.stdout).toEqual("");
    expect(result.stderr.includes("cwd is outside workspace")).toBeTruthy();
    expect(result.exit_code).toEqual(1);
  } finally {
    await remove(workspaceDir, { recursive: true });
    await remove(outsideDir, { recursive: true });
  }
});

test("ShellManager: exec command that fails returns non-zero exit_code", async () => {
  const tmpDir = await makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({ command: "exit 42" });
    expect(result.exit_code).toEqual(42);
    expect(result.timed_out).toEqual(false);
  } finally {
    await remove(tmpDir, { recursive: true });
  }
});

test("ShellManager: exec with stderr output", async () => {
  const tmpDir = await makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({ command: 'echo "error msg" >&2' });
    expect(result.stderr.trim()).toEqual("error msg");
    expect(result.exit_code).toEqual(0);
  } finally {
    await remove(tmpDir, { recursive: true });
  }
});

test("ShellManager: output truncation at 256KB limit", async () => {
  const tmpDir = await makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    // Generate 300,000 bytes of output (exceeds 256KB = 262,144 bytes)
    const result = await shell.exec({
      command: "yes | head -c 300000",
      timeout_ms: 10_000,
    });
    // Output should be truncated and contain the truncation marker
    expect(result.stdout.includes("... (truncated, 300000 bytes total)")).toBeTruthy();
    expect(result.exit_code).toEqual(0);
    expect(result.timed_out).toEqual(false);
  } finally {
    await remove(tmpDir, { recursive: true });
  }
});

test("ShellManager: timeout handling", async () => {
  const tmpDir = await makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const start = Date.now();
    const result = await shell.exec({
      command: "sleep 10",
      timeout_ms: 500,
    });
    const elapsed = Date.now() - start;
    // Should complete well before 10s due to timeout
    expect(elapsed < 5000).toBeTruthy();
    // Exit code is either 124 (AbortError path) or 143 (SIGTERM killed)
    expect(result.exit_code === 124 || result.exit_code === 143).toBeTruthy();
  } finally {
    await remove(tmpDir, { recursive: true });
  }
});

test("ShellManager: abort signal terminates running command", async () => {
  const tmpDir = await makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const controller = new AbortController();
    const promise = shell.exec({
      command: "sleep 10",
      timeout_ms: 10_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);

    const result = await promise;
    expect(result.timed_out).toEqual(false);
    expect(result.stderr.includes("Command aborted")).toBeTruthy();
  } finally {
    await remove(tmpDir, { recursive: true });
  }
});

test("ShellManager: killProcess rejects unsafe pid and signal inputs", () => {
  const shell = new ShellManager("/tmp");

  expect(
    () => shell.killProcess(1, "SIGTERM"),
  ).toThrow(
    "pid must be a positive integer greater than 1",
  );
  expect(
    () => shell.killProcess(1234, "SIGTERM; touch /tmp/pwned" as "SIGTERM"),
  ).toThrow(
    "Unsupported signal",
  );
});

test("ShellManager: killProcess rejects unmanaged processes", async () => {
  const shell = new ShellManager("/tmp");
  const proc = Bun.spawn(["bash", "-c", "sleep 30"], {
    stdout: "ignore",
    stderr: "ignore",
  });

  try {
    const result = shell.killProcess(proc.pid);
    expect(result.killed).toEqual(false);
    expect(result.pid).toEqual(proc.pid);
    expect(result.error?.includes("not managed")).toBeTruthy();
  } finally {
    try {
      proc.kill("SIGKILL");
    } catch {
      // Process may already be gone.
    }
    await proc.exited;
  }
});

test("ShellManager: exec with custom env", async () => {
  const tmpDir = await makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({
      command: "echo $MY_TEST_VAR",
      env: { MY_TEST_VAR: "custom_value" },
    });
    expect(result.stdout.trim()).toEqual("custom_value");
    expect(result.exit_code).toEqual(0);
  } finally {
    await remove(tmpDir, { recursive: true });
  }
});

test("ShellManager: exec does not inherit TAKOS_TOKEN by default", async () => {
  const tmpDir = await makeTempDir();
  const snapshot = {
    TAKOS_TOKEN: env.TAKOS_TOKEN,
  };
  try {
    env.TAKOS_TOKEN = "takos-api-token";

    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({
      command: 'printf "%s" "${TAKOS_TOKEN:-missing}"',
    });

    expect(result.stdout).toEqual("missing");
    expect(result.exit_code).toEqual(0);
  } finally {
    restoreEnv(snapshot);
    await remove(tmpDir, { recursive: true });
  }
});

test("ShellManager: exec can explicitly inherit TAKOS_TOKEN", async () => {
  const tmpDir = await makeTempDir();
  const snapshot = {
    TAKOS_TOKEN: env.TAKOS_TOKEN,
  };
  try {
    env.TAKOS_TOKEN = "takos-api-token";

    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({
      command: 'printf "%s" "${TAKOS_TOKEN:-missing}"',
      allow_takos_token: true,
    });

    expect(result.stdout).toEqual("takos-api-token");
    expect(result.exit_code).toEqual(0);
  } finally {
    restoreEnv(snapshot);
    await remove(tmpDir, { recursive: true });
  }
});

test("ShellManager: exec can use an explicit downscoped TAKOS token", async () => {
  const tmpDir = await makeTempDir();
  const snapshot = {
    TAKOS_TOKEN: env.TAKOS_TOKEN,
  };
  try {
    env.TAKOS_TOKEN = "takos-api-token";

    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({
      command: 'printf "%s" "${TAKOS_TOKEN:-missing}"',
      allow_takos_token: true,
      takos_token: "downscoped-token",
    });

    expect(result.stdout).toEqual("downscoped-token");
    expect(result.exit_code).toEqual(0);
  } finally {
    restoreEnv(snapshot);
    await remove(tmpDir, { recursive: true });
  }
});

test("ShellManager: exec rejects TAKOS token override without allow flag", async () => {
  const tmpDir = await makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({
      command: "echo unreachable",
      takos_token: "downscoped-token",
    });

    expect(result.stdout).toEqual("");
    expect(result.stderr.includes("requires allow_takos_token")).toBeTruthy();
    expect(result.exit_code).toEqual(1);
  } finally {
    await remove(tmpDir, { recursive: true });
  }
});

test("ShellManager: exec rejects sensitive env overrides", async () => {
  const tmpDir = await makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({
      command: "echo unreachable",
      env: { TAKOS_TOKEN: "override" },
    });

    expect(result.stdout).toEqual("");
    expect(result.stderr.includes("Sensitive environment variable")).toBeTruthy();
    expect(result.exit_code).toEqual(1);
  } finally {
    await remove(tmpDir, { recursive: true });
  }
});

test("ShellManager: exec rejects invalid env override values", async () => {
  const tmpDir = await makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({
      command: "echo unreachable",
      env: { SAFE_VAR: "line\nbreak" },
    });

    expect(result.stdout).toEqual("");
    expect(result.stderr.includes("invalid characters")).toBeTruthy();
    expect(result.exit_code).toEqual(1);
  } finally {
    await remove(tmpDir, { recursive: true });
  }
});

test("ShellManager: exec uses defaultCwd when no cwd specified", async () => {
  const tmpDir = await makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({ command: "pwd" });
    expect(result.stdout.trim()).toEqual(tmpDir);
  } finally {
    await remove(tmpDir, { recursive: true });
  }
});
