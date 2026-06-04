import { expect, test } from "bun:test";
import { join } from "node:path";
import { FsManager } from "../fs-manager.ts";
import { ShellManager } from "../shell-manager.ts";
import {
  makeTempDir,
  mkdir,
  remove,
  writeTextFile,
} from "./fs-helpers.ts";

// These tests pin the single shared workspace-containment boundary
// (WorkspaceJail) used by both FsManager and ShellManager. Before the jail was
// extracted, ShellManager used a separator-aware check while FsManager used a
// looser `!startsWith("..")` check, so the two sandboxes disagreed on whether a
// path whose relative form merely *begins* with ".." was inside the workspace.

test("WorkspaceJail: sibling path <root>..x is rejected by BOTH managers", async () => {
  const root = await makeTempDir();
  // A genuine sibling escape that shares the parent dir: the root path string
  // with "..x" appended directly (e.g. /tmp/ws -> /tmp/ws..x). relative(root, p)
  // resolves to "../<name>..x", a real parent-directory escape both must reject.
  const siblingEscape = `${root}..x`;
  try {
    await writeTextFile(siblingEscape, "outside");

    const fs = new FsManager(root);
    await expect(fs.read({ path: siblingEscape })).rejects.toThrow(
      "path is outside workspace",
    );
    await expect(fs.info(siblingEscape)).rejects.toThrow(
      "path is outside workspace",
    );

    const shell = new ShellManager(root);
    const result = await shell.exec({ command: "pwd", cwd: siblingEscape });
    expect(result.stdout).toEqual("");
    expect(result.stderr.includes("cwd is outside workspace")).toBeTruthy();
    expect(result.exit_code).toEqual(1);
  } finally {
    await remove(siblingEscape);
    await remove(root, { recursive: true });
  }
});

test("WorkspaceJail: child named '..x' is treated as INSIDE by BOTH managers", async () => {
  // Canonical (stricter, separator-aware) check: a child whose name merely
  // starts with ".." is a legitimate in-workspace path, not a parent escape.
  // FsManager previously rejected it while ShellManager accepted it; both now
  // agree it is inside.
  const root = await makeTempDir();
  try {
    const childDir = join(root, "..x");
    await mkdir(childDir);
    const childFile = join(childDir, "note.txt");
    await writeTextFile(childFile, "inside");

    const fs = new FsManager(root);
    const read = await fs.read({ path: childFile });
    expect(read.content).toEqual("inside");
    const info = await fs.info(childDir);
    expect(info.exists).toEqual(true);
    expect(info.type).toEqual("directory");

    const shell = new ShellManager(root);
    const result = await shell.exec({ command: "pwd -P", cwd: childDir });
    expect(result.exit_code).toEqual(0);
    expect(result.stdout.trim()).toEqual(childDir);
  } finally {
    await remove(root, { recursive: true });
  }
});
