import { build } from "esbuild";
import type { Plugin } from "esbuild";
import { fileURLToPath } from "node:url";

type TargetName = "sandbox";

const targets: Record<TargetName, { entry: string; outfile: string }> = {
  sandbox: {
    entry: "../src/sandbox-host.ts",
    outfile: "../../../dist/sandbox-host.js",
  },
};

const targetName = Deno.args[0] as TargetName | undefined;
if (!targetName || !(targetName in targets)) {
  throw new Error("Usage: bun run build:sandbox-host -- [--outfile <path>]");
}

const target = targets[targetName];
const defaultOutfile = fileURLToPath(new URL(target.outfile, import.meta.url));
let outfile = defaultOutfile;
for (let index = 1; index < Deno.args.length; index++) {
  const arg = Deno.args[index];
  if (arg === "--outfile") {
    const value = Deno.args[++index];
    if (!value) throw new Error("--outfile requires a path");
    outfile = value;
    continue;
  }
  throw new Error(`Unknown argument: ${arg}`);
}

const generatedAssetsUrl = new URL(
  "../src/gui/assets.generated.ts",
  import.meta.url,
);
const generatedAssetsSource = await Deno.readTextFile(generatedAssetsUrl);
if (
  generatedAssetsSource.includes("Dashboard not built.") ||
  generatedAssetsSource.includes("Keep this placeholder in sync")
) {
  throw new Error(
    "Dashboard assets are still placeholders. Run `bun run build:dashboard` before `bun run build:sandbox-host`.",
  );
}

function denoResolvePlugin(): Plugin {
  return {
    name: "deno-resolve",
    setup(builder) {
      builder.onResolve(
        { filter: /^cloudflare:/ },
        (args) => ({ path: args.path, external: true }),
      );

      builder.onResolve(
        { filter: /^[^./][^:]*/ },
        async (args) => {
          const resolved = await import.meta.resolve(args.path);
          if (resolved.startsWith("file:")) {
            return { path: fileURLToPath(resolved) };
          }
          return { path: resolved, external: true };
        },
      );
    },
  };
}

await build({
  entryPoints: [new URL(target.entry, import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile,
  loader: {
    ".html": "text",
    ".css": "text",
  },
  plugins: [denoResolvePlugin()],
  logLevel: "info",
});

console.log(
  `Built ${targetName}: ${
    outfile === defaultOutfile ? target.outfile : outfile
  }`,
);
