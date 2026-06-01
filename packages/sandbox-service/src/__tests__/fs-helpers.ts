import {
  mkdir as nodeMkdir,
  mkdtemp,
  readFile,
  rm,
  symlink as nodeSymlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function makeTempDir(options?: { prefix?: string }): Promise<string> {
  return await mkdtemp(join(tmpdir(), options?.prefix ?? "takos-computer-test-"));
}

export async function makeTempFile(options?: { prefix?: string }): Promise<string> {
  const dir = await makeTempDir({ prefix: options?.prefix ?? "takos-computer-file-" });
  const path = join(dir, "tmp");
  await writeFile(path, "");
  return path;
}

export async function remove(path: string, options?: { recursive?: boolean }): Promise<void> {
  await rm(path, { recursive: options?.recursive ?? false, force: true });
}

export async function writeTextFile(path: string, text: string): Promise<void> {
  await writeFile(path, text);
}

export async function readTextFile(path: string): Promise<string> {
  return await readFile(path, "utf8");
}

export async function mkdir(path: string): Promise<void> {
  await nodeMkdir(path);
}

export async function symlink(
  target: string,
  path: string,
  options?: { type?: "file" | "dir" },
): Promise<void> {
  await nodeSymlink(target, path, options?.type);
}
