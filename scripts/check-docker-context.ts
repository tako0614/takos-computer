import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const dockerfilePath = resolve(repositoryRoot, "apps/sandbox/Dockerfile");
const dockerfile = await readFile(dockerfilePath, "utf8");
const missing: string[] = [];

for (const line of dockerfile.split(/\r?\n/)) {
  const match = line.trim().match(/^COPY\s+(.+)$/i);
  if (!match || match[1]!.startsWith("--from=")) continue;
  const fields = match[1]!.split(/\s+/);
  for (const source of fields.slice(0, -1)) {
    if (source.includes("*") || /^https?:\/\//.test(source)) continue;
    try {
      await access(resolve(repositoryRoot, source));
    } catch {
      missing.push(source);
    }
  }
}

if (missing.length > 0) {
  throw new Error(
    `apps/sandbox/Dockerfile references missing build-context paths: ${
      missing.join(", ")
    }`,
  );
}

const dockerignore = new Set(
  (await readFile(resolve(repositoryRoot, ".dockerignore"), "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean),
);
for (const required of [".git", ".env", ".env.*", "node_modules"]) {
  if (!dockerignore.has(required)) {
    throw new Error(`.dockerignore must exclude ${required}`);
  }
}

console.log("sandbox Docker build context: ok");
