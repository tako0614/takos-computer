import { expect, test } from "bun:test";
import { FsManager } from "../fs-manager.ts";
import { join } from "node:path";
import {
  makeTempDir,
  makeTempFile,
  mkdir,
  readTextFile,
  remove,
  symlink,
  writeTextFile,
} from "./fs-helpers.ts";

let tmpDir: string;
let fs: FsManager;

async function setup(): Promise<void> {
  tmpDir = await makeTempDir();
  fs = new FsManager(tmpDir);
}

async function cleanup(): Promise<void> {
  await remove(tmpDir, { recursive: true });
}

// ---------- read ----------

test("FsManager.read: existing file returns content", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "test.txt");
    await writeTextFile(filePath, "hello world");

    const result = await fs.read({ path: filePath });
    expect(result.content).toEqual("hello world");
    expect(result.size).toEqual(11);
    expect(result.truncated).toEqual(false);
  } finally {
    await cleanup();
  }
});

test("FsManager.read: non-existent file throws", async () => {
  await setup();
  try {
    await expect(
      fs.read({ path: join(tmpDir, "nonexistent.txt") }),
    ).rejects.toThrow();
  } finally {
    await cleanup();
  }
});

test("FsManager.read: with offset and limit", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "offset.txt");
    await writeTextFile(filePath, "abcdefghij");

    const result = await fs.read({ path: filePath, offset: 3, limit: 4 });
    expect(result.content).toEqual("defg");
    expect(result.size).toEqual(10);
    expect(result.truncated).toEqual(true); // offset + limit < totalSize
  } finally {
    await cleanup();
  }
});

test("FsManager.read: base64 encoding", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "b64.txt");
    await writeTextFile(filePath, "hello");

    const result = await fs.read({ path: filePath, encoding: "base64" });
    expect(result.content).toEqual(btoa("hello"));
  } finally {
    await cleanup();
  }
});

test("FsManager.read: caps reads at 256KB without returning whole file", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "large.txt");
    const content = "x".repeat(300_000);
    await writeTextFile(filePath, content);

    const result = await fs.read({ path: filePath, limit: 300_000 });
    expect(result.content.length).toEqual(256 * 1024);
    expect(result.size).toEqual(300_000);
    expect(result.truncated).toEqual(true);
  } finally {
    await cleanup();
  }
});

test("FsManager.read: rejects negative offset", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "test.txt");
    await writeTextFile(filePath, "hello");

    await expect(fs.read({ path: filePath, offset: -1 })).rejects.toThrow(
      "offset must be a non-negative integer",
    );
  } finally {
    await cleanup();
  }
});

test("FsManager.read: rejects paths outside workspace", async () => {
  await setup();
  const outsideFile = await makeTempFile();
  try {
    await writeTextFile(outsideFile, "outside");

    await expect(fs.read({ path: outsideFile })).rejects.toThrow(
      "path is outside workspace",
    );
    await expect(fs.read({ path: "../outside.txt" })).rejects.toThrow(
      "path is outside workspace",
    );
  } finally {
    await remove(outsideFile);
    await cleanup();
  }
});

test("FsManager.read: rejects symlink escape", async () => {
  await setup();
  const outsideFile = await makeTempFile();
  try {
    await writeTextFile(outsideFile, "outside");
    const linkPath = join(tmpDir, "outside-link.txt");
    await symlink(outsideFile, linkPath);

    await expect(fs.read({ path: linkPath })).rejects.toThrow(
      "path is outside workspace",
    );
  } finally {
    await remove(outsideFile);
    await cleanup();
  }
});

// ---------- write ----------

test("FsManager.write: new file", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "new.txt");
    const result = await fs.write({ path: filePath, content: "new content" });
    expect(result.path).toEqual(filePath);
    expect(result.bytes_written > 0).toBeTruthy();

    const written = await readTextFile(filePath);
    expect(written).toEqual("new content");
  } finally {
    await cleanup();
  }
});

test("FsManager.write: overwrite existing", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "overwrite.txt");
    await writeTextFile(filePath, "old");
    await fs.write({ path: filePath, content: "new" });

    const written = await readTextFile(filePath);
    expect(written).toEqual("new");
  } finally {
    await cleanup();
  }
});

test("FsManager.write: create directories", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "a", "b", "c", "deep.txt");
    await fs.write({ path: filePath, content: "deep", create_dirs: true });

    const written = await readTextFile(filePath);
    expect(written).toEqual("deep");
  } finally {
    await cleanup();
  }
});

test("FsManager.write: base64 encoding", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "b64write.txt");
    const encoded = btoa("binary data");
    await fs.write({ path: filePath, content: encoded, encoding: "base64" });

    const written = await readTextFile(filePath);
    expect(written).toEqual("binary data");
  } finally {
    await cleanup();
  }
});

test("FsManager.write: refuses symlink target", async () => {
  await setup();
  const outsideFile = await makeTempFile();
  try {
    const linkPath = join(tmpDir, "write-link.txt");
    await symlink(outsideFile, linkPath);

    await expect(fs.write({ path: linkPath, content: "nope" })).rejects.toThrow(
      "refusing to write through symlink",
    );
  } finally {
    await remove(outsideFile);
    await cleanup();
  }
});

test("FsManager.write: create_dirs refuses symlink parent escape", async () => {
  await setup();
  const outsideDir = await makeTempDir();
  try {
    const linkPath = join(tmpDir, "outside-dir");
    await symlink(outsideDir, linkPath);

    await expect(
      fs.write({
        path: join(linkPath, "nested", "file.txt"),
        content: "nope",
        create_dirs: true,
      }),
    ).rejects.toThrow("path is outside workspace");
  } finally {
    await remove(outsideDir, { recursive: true });
    await cleanup();
  }
});

// ---------- list ----------

test("FsManager.list: directory contents", async () => {
  await setup();
  try {
    await writeTextFile(join(tmpDir, "a.txt"), "a");
    await writeTextFile(join(tmpDir, "b.txt"), "b");
    await mkdir(join(tmpDir, "subdir"));

    const entries = await fs.list({ path: tmpDir });
    expect(entries.length).toEqual(3);

    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["a.txt", "b.txt", "subdir"]);

    const subdirEntry = entries.find((e) => e.name === "subdir");
    expect(subdirEntry?.type).toEqual("directory");

    const fileEntry = entries.find((e) => e.name === "a.txt");
    expect(fileEntry?.type).toEqual("file");
  } finally {
    await cleanup();
  }
});

test("FsManager.list: with glob filter", async () => {
  await setup();
  try {
    await writeTextFile(join(tmpDir, "file.ts"), "ts");
    await writeTextFile(join(tmpDir, "file.js"), "js");
    await writeTextFile(join(tmpDir, "file.txt"), "txt");

    const entries = await fs.list({ path: tmpDir, glob: "*.ts" });
    expect(entries.length).toEqual(1);
    expect(entries[0].name).toEqual("file.ts");
  } finally {
    await cleanup();
  }
});

test("FsManager.list: ? and multi-* globs match correctly", async () => {
  await setup();
  try {
    await writeTextFile(join(tmpDir, "ab.log"), "1");
    await writeTextFile(join(tmpDir, "axb.log"), "2");
    await writeTextFile(join(tmpDir, "report-2026.csv"), "3");

    const single = await fs.list({ path: tmpDir, glob: "a?.log" });
    expect(single.map((e) => e.name).sort()).toEqual(["ab.log"]);

    const multi = await fs.list({ path: tmpDir, glob: "*-*.csv" });
    expect(multi.map((e) => e.name).sort()).toEqual(["report-2026.csv"]);

    const allLogs = await fs.list({ path: tmpDir, glob: "*.log" });
    expect(allLogs.map((e) => e.name).sort()).toEqual(["ab.log", "axb.log"]);
  } finally {
    await cleanup();
  }
});

test("FsManager.list: pathological glob returns quickly (no ReDoS)", async () => {
  await setup();
  try {
    // A non-matching long filename: the old `*` -> `.*` regex wedged the
    // event loop for >100s on this input. The linear matcher must be fast.
    await writeTextFile(join(tmpDir, "a".repeat(40)), "x");

    const start = performance.now();
    const entries = await fs.list({
      path: tmpDir,
      glob: "*".repeat(30) + "x",
    });
    const elapsed = performance.now() - start;

    expect(entries.length).toEqual(0); // none end with "x"
    expect(elapsed).toBeLessThan(1000);
  } finally {
    await cleanup();
  }
});

test("FsManager.list: over-long glob is rejected, not run", async () => {
  await setup();
  try {
    await writeTextFile(join(tmpDir, "file.ts"), "ts");
    let threw = false;
    try {
      await fs.list({ path: tmpDir, glob: "*".repeat(2000) });
    } catch (err) {
      threw = true;
      expect(String(err)).toContain("glob pattern too long");
    }
    expect(threw).toBeTruthy();
  } finally {
    await cleanup();
  }
});

test("FsManager.list: recursive", async () => {
  await setup();
  try {
    await mkdir(join(tmpDir, "sub"));
    await writeTextFile(join(tmpDir, "root.txt"), "r");
    await writeTextFile(join(tmpDir, "sub", "nested.txt"), "n");

    const entries = await fs.list({ path: tmpDir, recursive: true });
    // Recursive mode returns full paths for files and skips directories in entries
    expect(entries.length >= 2).toBeTruthy();
    const names = entries.map((e) => e.name);
    expect(names.some((n) => n.endsWith("root.txt"))).toBeTruthy();
    expect(names.some((n) => n.endsWith("nested.txt"))).toBeTruthy();
  } finally {
    await cleanup();
  }
});

// ---------- info ----------

test("FsManager.info: existing file metadata", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "info.txt");
    await writeTextFile(filePath, "hello");

    const info = await fs.info(filePath);
    expect(info.exists).toEqual(true);
    expect(info.type).toEqual("file");
    expect(info.size).toEqual(5);
    expect(info.modified !== null).toBeTruthy();
  } finally {
    await cleanup();
  }
});

test("FsManager.info: directory metadata", async () => {
  await setup();
  try {
    const info = await fs.info(tmpDir);
    expect(info.exists).toEqual(true);
    expect(info.type).toEqual("directory");
  } finally {
    await cleanup();
  }
});

test("FsManager.info: non-existent path", async () => {
  await setup();
  try {
    const info = await fs.info(join(tmpDir, "no-such-file"));
    expect(info.exists).toEqual(false);
    expect(info.type).toEqual("unknown");
    expect(info.size).toEqual(0);
    expect(info.modified).toEqual(null);
    expect(info.permissions).toEqual(null);
  } finally {
    await cleanup();
  }
});

test("FsManager.info: rejects symlink escape", async () => {
  await setup();
  const outsideFile = await makeTempFile();
  try {
    const linkPath = join(tmpDir, "info-link.txt");
    await symlink(outsideFile, linkPath);

    await expect(fs.info(linkPath)).rejects.toThrow("path is outside workspace");
  } finally {
    await remove(outsideFile);
    await cleanup();
  }
});
