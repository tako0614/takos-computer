import { assert, assertEquals, assertRejects } from "@std/assert";
import { FsManager } from "../fs-manager.ts";
import { join } from "node:path";

let tmpDir: string;
let fs: FsManager;

async function setup(): Promise<void> {
  tmpDir = await Deno.makeTempDir();
  fs = new FsManager(tmpDir);
}

async function cleanup(): Promise<void> {
  await Deno.remove(tmpDir, { recursive: true });
}

// ---------- read ----------

Deno.test("FsManager.read: existing file returns content", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "test.txt");
    await Deno.writeTextFile(filePath, "hello world");

    const result = await fs.read({ path: filePath });
    assertEquals(result.content, "hello world");
    assertEquals(result.size, 11);
    assertEquals(result.truncated, false);
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.read: non-existent file throws", async () => {
  await setup();
  try {
    await assertRejects(
      () => fs.read({ path: join(tmpDir, "nonexistent.txt") }),
      Deno.errors.NotFound,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.read: with offset and limit", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "offset.txt");
    await Deno.writeTextFile(filePath, "abcdefghij");

    const result = await fs.read({ path: filePath, offset: 3, limit: 4 });
    assertEquals(result.content, "defg");
    assertEquals(result.size, 10);
    assertEquals(result.truncated, true); // offset + limit < totalSize
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.read: base64 encoding", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "b64.txt");
    await Deno.writeTextFile(filePath, "hello");

    const result = await fs.read({ path: filePath, encoding: "base64" });
    assertEquals(result.content, btoa("hello"));
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.read: caps reads at 256KB without returning whole file", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "large.txt");
    const content = "x".repeat(300_000);
    await Deno.writeTextFile(filePath, content);

    const result = await fs.read({ path: filePath, limit: 300_000 });
    assertEquals(result.content.length, 256 * 1024);
    assertEquals(result.size, 300_000);
    assertEquals(result.truncated, true);
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.read: rejects negative offset", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "test.txt");
    await Deno.writeTextFile(filePath, "hello");

    await assertRejects(
      () => fs.read({ path: filePath, offset: -1 }),
      Error,
      "offset must be a non-negative integer",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.read: rejects paths outside workspace", async () => {
  await setup();
  const outsideFile = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(outsideFile, "outside");

    await assertRejects(
      () => fs.read({ path: outsideFile }),
      Error,
      "path is outside workspace",
    );
    await assertRejects(
      () => fs.read({ path: "../outside.txt" }),
      Error,
      "path is outside workspace",
    );
  } finally {
    await Deno.remove(outsideFile);
    await cleanup();
  }
});

Deno.test("FsManager.read: rejects symlink escape", async () => {
  await setup();
  const outsideFile = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(outsideFile, "outside");
    const linkPath = join(tmpDir, "outside-link.txt");
    await Deno.symlink(outsideFile, linkPath);

    await assertRejects(
      () => fs.read({ path: linkPath }),
      Error,
      "path is outside workspace",
    );
  } finally {
    await Deno.remove(outsideFile);
    await cleanup();
  }
});

// ---------- write ----------

Deno.test("FsManager.write: new file", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "new.txt");
    const result = await fs.write({ path: filePath, content: "new content" });
    assertEquals(result.path, filePath);
    assert(result.bytes_written > 0);

    const written = await Deno.readTextFile(filePath);
    assertEquals(written, "new content");
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.write: overwrite existing", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "overwrite.txt");
    await Deno.writeTextFile(filePath, "old");
    await fs.write({ path: filePath, content: "new" });

    const written = await Deno.readTextFile(filePath);
    assertEquals(written, "new");
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.write: create directories", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "a", "b", "c", "deep.txt");
    await fs.write({ path: filePath, content: "deep", create_dirs: true });

    const written = await Deno.readTextFile(filePath);
    assertEquals(written, "deep");
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.write: base64 encoding", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "b64write.txt");
    const encoded = btoa("binary data");
    await fs.write({ path: filePath, content: encoded, encoding: "base64" });

    const written = await Deno.readTextFile(filePath);
    assertEquals(written, "binary data");
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.write: refuses symlink target", async () => {
  await setup();
  const outsideFile = await Deno.makeTempFile();
  try {
    const linkPath = join(tmpDir, "write-link.txt");
    await Deno.symlink(outsideFile, linkPath);

    await assertRejects(
      () => fs.write({ path: linkPath, content: "nope" }),
      Error,
      "refusing to write through symlink",
    );
  } finally {
    await Deno.remove(outsideFile);
    await cleanup();
  }
});

Deno.test("FsManager.write: create_dirs refuses symlink parent escape", async () => {
  await setup();
  const outsideDir = await Deno.makeTempDir();
  try {
    const linkPath = join(tmpDir, "outside-dir");
    await Deno.symlink(outsideDir, linkPath);

    await assertRejects(
      () =>
        fs.write({
          path: join(linkPath, "nested", "file.txt"),
          content: "nope",
          create_dirs: true,
        }),
      Error,
      "path is outside workspace",
    );
  } finally {
    await Deno.remove(outsideDir, { recursive: true });
    await cleanup();
  }
});

// ---------- list ----------

Deno.test("FsManager.list: directory contents", async () => {
  await setup();
  try {
    await Deno.writeTextFile(join(tmpDir, "a.txt"), "a");
    await Deno.writeTextFile(join(tmpDir, "b.txt"), "b");
    await Deno.mkdir(join(tmpDir, "subdir"));

    const entries = await fs.list({ path: tmpDir });
    assertEquals(entries.length, 3);

    const names = entries.map((e) => e.name).sort();
    assertEquals(names, ["a.txt", "b.txt", "subdir"]);

    const subdirEntry = entries.find((e) => e.name === "subdir");
    assertEquals(subdirEntry?.type, "directory");

    const fileEntry = entries.find((e) => e.name === "a.txt");
    assertEquals(fileEntry?.type, "file");
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.list: with glob filter", async () => {
  await setup();
  try {
    await Deno.writeTextFile(join(tmpDir, "file.ts"), "ts");
    await Deno.writeTextFile(join(tmpDir, "file.js"), "js");
    await Deno.writeTextFile(join(tmpDir, "file.txt"), "txt");

    const entries = await fs.list({ path: tmpDir, glob: "*.ts" });
    assertEquals(entries.length, 1);
    assertEquals(entries[0].name, "file.ts");
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.list: recursive", async () => {
  await setup();
  try {
    await Deno.mkdir(join(tmpDir, "sub"));
    await Deno.writeTextFile(join(tmpDir, "root.txt"), "r");
    await Deno.writeTextFile(join(tmpDir, "sub", "nested.txt"), "n");

    const entries = await fs.list({ path: tmpDir, recursive: true });
    // Recursive mode returns full paths for files and skips directories in entries
    assert(entries.length >= 2);
    const names = entries.map((e) => e.name);
    assert(names.some((n) => n.endsWith("root.txt")));
    assert(names.some((n) => n.endsWith("nested.txt")));
  } finally {
    await cleanup();
  }
});

// ---------- info ----------

Deno.test("FsManager.info: existing file metadata", async () => {
  await setup();
  try {
    const filePath = join(tmpDir, "info.txt");
    await Deno.writeTextFile(filePath, "hello");

    const info = await fs.info(filePath);
    assertEquals(info.exists, true);
    assertEquals(info.type, "file");
    assertEquals(info.size, 5);
    assert(info.modified !== null);
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.info: directory metadata", async () => {
  await setup();
  try {
    const info = await fs.info(tmpDir);
    assertEquals(info.exists, true);
    assertEquals(info.type, "directory");
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.info: non-existent path", async () => {
  await setup();
  try {
    const info = await fs.info(join(tmpDir, "no-such-file"));
    assertEquals(info.exists, false);
    assertEquals(info.type, "unknown");
    assertEquals(info.size, 0);
    assertEquals(info.modified, null);
    assertEquals(info.permissions, null);
  } finally {
    await cleanup();
  }
});

Deno.test("FsManager.info: rejects symlink escape", async () => {
  await setup();
  const outsideFile = await Deno.makeTempFile();
  try {
    const linkPath = join(tmpDir, "info-link.txt");
    await Deno.symlink(outsideFile, linkPath);

    await assertRejects(
      () => fs.info(linkPath),
      Error,
      "path is outside workspace",
    );
  } finally {
    await Deno.remove(outsideFile);
    await cleanup();
  }
});
