import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

const rootUrl = new URL("../", import.meta.url);
const root = fileURLToPath(rootUrl);
const expectedPath = fileURLToPath(new URL("dist/sandbox-host.js", rootUrl));
async function main(): Promise<number> {
  const tempDir = await mkdtemp(join(tmpdir(), "takos-computer-dist-check-"));
  const generatedPath = `${tempDir}/sandbox-host.js`;

  try {
    const build = Bun.spawn([
      "bun",
      "packages/computer-hosts/scripts/build-host.ts",
      "sandbox",
      "--outfile",
      generatedPath,
    ], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const decoder = new TextDecoder();
    const [code, stdoutBytes, stderrBytes] = await Promise.all([
      build.exited,
      new Response(build.stdout).arrayBuffer(),
      new Response(build.stderr).arrayBuffer(),
    ]);
    const stdout = decoder.decode(stdoutBytes).trim();
    const stderr = decoder.decode(stderrBytes).trim();
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    if (code !== 0) return code;

    const [expected, generated] = await Promise.all([
      readFile(expectedPath, "utf8"),
      readFile(generatedPath, "utf8"),
    ]);
    if (expected !== generated) {
      console.error(
        "dist/sandbox-host.js is out of date. Run `bun run build:all` and commit the generated bundle.",
      );
      return 1;
    }
    console.log("dist/sandbox-host.js is up to date.");
    return 0;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

exit(await main());
