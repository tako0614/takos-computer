import { assert, assertEquals, assertThrows } from "@std/assert";
import { ShellManager } from "../shell-manager.ts";

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
}

Deno.test("ShellManager: exec simple command returns stdout", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({ command: 'echo "hello"' });
    assertEquals(result.stdout.trim(), "hello");
    assertEquals(result.stderr, "");
    assertEquals(result.exit_code, 0);
    assertEquals(result.timed_out, false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("ShellManager: exec with custom cwd", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const shell = new ShellManager("/tmp");
    const result = await shell.exec({ command: "pwd", cwd: tmpDir });
    assertEquals(result.stdout.trim(), tmpDir);
    assertEquals(result.exit_code, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("ShellManager: exec command that fails returns non-zero exit_code", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({ command: "exit 42" });
    assertEquals(result.exit_code, 42);
    assertEquals(result.timed_out, false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("ShellManager: exec with stderr output", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({ command: 'echo "error msg" >&2' });
    assertEquals(result.stderr.trim(), "error msg");
    assertEquals(result.exit_code, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("ShellManager: output truncation at 256KB limit", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    // Generate 300,000 bytes of output (exceeds 256KB = 262,144 bytes)
    const result = await shell.exec({
      command: "yes | head -c 300000",
      timeout_ms: 10_000,
    });
    // Output should be truncated and contain the truncation marker
    assert(result.stdout.includes("... (truncated, 300000 bytes total)"));
    assertEquals(result.exit_code, 0);
    assertEquals(result.timed_out, false);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("ShellManager: timeout handling", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const start = Date.now();
    const result = await shell.exec({
      command: "sleep 10",
      timeout_ms: 500,
    });
    const elapsed = Date.now() - start;
    // Should complete well before 10s due to timeout
    assert(elapsed < 5000, `Should time out quickly, took ${elapsed}ms`);
    // Exit code is either 124 (AbortError path) or 143 (SIGTERM killed)
    assert(
      result.exit_code === 124 || result.exit_code === 143,
      `Expected exit code 124 or 143, got ${result.exit_code}`,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("ShellManager: abort signal terminates running command", async () => {
  const tmpDir = await Deno.makeTempDir();
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
    assertEquals(result.timed_out, false);
    assert(result.stderr.includes("Command aborted"));
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("ShellManager: killProcess rejects unsafe pid and signal inputs", () => {
  const shell = new ShellManager("/tmp");

  assertThrows(
    () => shell.killProcess(1, "SIGTERM"),
    Error,
    "pid must be a positive integer greater than 1",
  );
  assertThrows(
    () => shell.killProcess(1234, "SIGTERM; touch /tmp/pwned" as "SIGTERM"),
    Error,
    "Unsupported signal",
  );
});

Deno.test("ShellManager: killProcess rejects unmanaged processes", async () => {
  const shell = new ShellManager("/tmp");
  const proc = new Deno.Command("bash", {
    args: ["-c", "sleep 30"],
    stdout: "null",
    stderr: "null",
  }).spawn();

  try {
    const result = shell.killProcess(proc.pid);
    assertEquals(result.killed, false);
    assertEquals(result.pid, proc.pid);
    assert(result.error?.includes("not managed"));
  } finally {
    try {
      proc.kill("SIGKILL");
    } catch {
      // Process may already be gone.
    }
    await proc.status;
  }
});

Deno.test("ShellManager: exec with custom env", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({
      command: "echo $MY_TEST_VAR",
      env: { MY_TEST_VAR: "custom_value" },
    });
    assertEquals(result.stdout.trim(), "custom_value");
    assertEquals(result.exit_code, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("ShellManager: exec does not inherit TAKOS_TOKEN by default", async () => {
  const tmpDir = await Deno.makeTempDir();
  const snapshot = {
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
  };
  try {
    Deno.env.set("TAKOS_TOKEN", "takos-cli-token");

    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({
      command: 'printf "%s" "${TAKOS_TOKEN:-missing}"',
    });

    assertEquals(result.stdout, "missing");
    assertEquals(result.exit_code, 0);
  } finally {
    restoreEnv(snapshot);
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("ShellManager: exec can explicitly inherit TAKOS_TOKEN", async () => {
  const tmpDir = await Deno.makeTempDir();
  const snapshot = {
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
  };
  try {
    Deno.env.set("TAKOS_TOKEN", "takos-cli-token");

    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({
      command: 'printf "%s" "${TAKOS_TOKEN:-missing}"',
      allow_takos_token: true,
    });

    assertEquals(result.stdout, "takos-cli-token");
    assertEquals(result.exit_code, 0);
  } finally {
    restoreEnv(snapshot);
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("ShellManager: exec can use an explicit downscoped TAKOS token", async () => {
  const tmpDir = await Deno.makeTempDir();
  const snapshot = {
    TAKOS_TOKEN: Deno.env.get("TAKOS_TOKEN"),
  };
  try {
    Deno.env.set("TAKOS_TOKEN", "takos-cli-token");

    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({
      command: 'printf "%s" "${TAKOS_TOKEN:-missing}"',
      allow_takos_token: true,
      takos_token: "downscoped-token",
    });

    assertEquals(result.stdout, "downscoped-token");
    assertEquals(result.exit_code, 0);
  } finally {
    restoreEnv(snapshot);
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("ShellManager: exec rejects TAKOS token override without allow flag", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({
      command: "echo unreachable",
      takos_token: "downscoped-token",
    });

    assertEquals(result.stdout, "");
    assert(result.stderr.includes("requires allow_takos_token"));
    assertEquals(result.exit_code, 1);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("ShellManager: exec rejects sensitive env overrides", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({
      command: "echo unreachable",
      env: { TAKOS_TOKEN: "override" },
    });

    assertEquals(result.stdout, "");
    assert(result.stderr.includes("Sensitive environment variable"));
    assertEquals(result.exit_code, 1);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("ShellManager: exec rejects invalid env override values", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({
      command: "echo unreachable",
      env: { SAFE_VAR: "line\nbreak" },
    });

    assertEquals(result.stdout, "");
    assert(result.stderr.includes("invalid characters"));
    assertEquals(result.exit_code, 1);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("ShellManager: exec uses defaultCwd when no cwd specified", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const shell = new ShellManager(tmpDir);
    const result = await shell.exec({ command: "pwd" });
    assertEquals(result.stdout.trim(), tmpDir);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
