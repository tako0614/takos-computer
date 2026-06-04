/**
 * Workspace containment jail.
 *
 * Single source of truth for the sandbox path-traversal boundary shared by the
 * shell and filesystem managers. Both managers hold one instance and delegate
 * all containment decisions here so the two sandboxes can never disagree on
 * which paths are inside the workspace.
 *
 * The canonical containment check is separator-aware: a relative path is only
 * treated as an escape when it is exactly `..` or begins with `..<sep>`. This
 * keeps legitimate children whose names merely start with `..` (e.g. a file
 * literally named `..foo`) inside the jail while still rejecting genuine
 * parent-directory traversal.
 */

import { dirname, isAbsolute, relative, resolve } from "node:path";
import { sep } from "node:path";
import { lstat, realpath } from "node:fs/promises";

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT";
}

export class WorkspaceJail {
  readonly workspaceRoot: string;
  private workspaceRealRoot: string | null = null;
  /** Noun used in error messages, e.g. "path" or "cwd". */
  private readonly noun: string;

  constructor(workspaceRoot: string, options?: { noun?: string }) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.noun = options?.noun ?? "path";
  }

  /**
   * Resolve a caller-supplied path lexically (without touching the filesystem)
   * against the workspace root. Absolute paths are resolved as-is; relative
   * paths are resolved under the workspace root.
   */
  resolveLexicalPath(path: string): string {
    if (!path || path.includes("\0")) {
      throw new Error(`${this.noun} must be a non-empty string`);
    }
    return isAbsolute(path) ? resolve(path) : resolve(this.workspaceRoot, path);
  }

  /** Cached real (symlink-resolved) workspace root. */
  async getWorkspaceRealRoot(): Promise<string> {
    if (!this.workspaceRealRoot) {
      this.workspaceRealRoot = resolve(await realpath(this.workspaceRoot));
    }
    return this.workspaceRealRoot;
  }

  /**
   * Canonical separator-aware containment check. Throws when `path` is outside
   * `root` (defaults to the lexical workspace root).
   */
  assertInsideWorkspace(path: string, root: string = this.workspaceRoot): void {
    const rel = relative(root, path);
    if (
      rel === "" ||
      (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
    ) {
      return;
    }
    throw new Error(`${this.noun} is outside workspace`);
  }

  /**
   * Resolve an existing path through realpath and assert both the lexical and
   * real paths are inside the workspace. Returns the resolved real path.
   */
  async resolveExistingPath(path: string): Promise<string> {
    const lexicalPath = this.resolveLexicalPath(path);
    this.assertInsideWorkspace(lexicalPath);
    const [realRoot, realPath] = await Promise.all([
      this.getWorkspaceRealRoot(),
      realpath(lexicalPath),
    ]);
    this.assertInsideWorkspace(resolve(realPath), realRoot);
    return resolve(realPath);
  }

  /**
   * Assert that a (possibly not-yet-existing) lexical path is a safe write
   * target: its parent's real path is inside the workspace, and if the target
   * already exists it is not a symlink and its real path stays inside.
   */
  async assertWritable(path: string): Promise<void> {
    const realRoot = await this.getWorkspaceRealRoot();
    const parentRealPath = resolve(await realpath(dirname(path)));
    this.assertInsideWorkspace(parentRealPath, realRoot);

    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        throw new Error("refusing to write through symlink");
      }
      const realPath = resolve(await realpath(path));
      this.assertInsideWorkspace(realPath, realRoot);
    } catch (err) {
      if (isNotFoundError(err)) return;
      throw err;
    }
  }
}
