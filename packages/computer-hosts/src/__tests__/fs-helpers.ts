import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function makeTempDir(options?: { prefix?: string }): Promise<string> {
  return await mkdtemp(join(tmpdir(), options?.prefix ?? "takos-computer-host-"));
}

export async function remove(path: string, options?: { recursive?: boolean }): Promise<void> {
  await rm(path, { recursive: options?.recursive ?? false, force: true });
}
