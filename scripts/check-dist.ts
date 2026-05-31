import { fileURLToPath } from "node:url";

const rootUrl = new URL("../", import.meta.url);
const root = fileURLToPath(rootUrl);
const expectedPath = fileURLToPath(new URL("dist/sandbox-host.js", rootUrl));
async function main(): Promise<number> {
  const tempDir = await Deno.makeTempDir({
    dir: root,
    prefix: ".dist-check-",
  });
  const generatedPath = `${tempDir}/sandbox-host.js`;

  try {
    const build = new Deno.Command(Deno.execPath(), {
      args: [
        "--preload",
        "./shims/deno-compat.ts",
        "packages/computer-hosts/scripts/build-host.ts",
        "sandbox",
        "--outfile",
        generatedPath,
      ],
      cwd: root,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await build.output();
    const decoder = new TextDecoder();
    const stdout = decoder.decode(output.stdout).trim();
    const stderr = decoder.decode(output.stderr).trim();
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    if (!output.success) return output.code;

    const [expected, generated] = await Promise.all([
      Deno.readTextFile(expectedPath),
      Deno.readTextFile(generatedPath),
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
    await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
  }
}

Deno.exit(await main());
