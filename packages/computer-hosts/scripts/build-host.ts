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
  throw new Error("Usage: deno task build:sandbox-host");
}

const target = targets[targetName];

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
    "Dashboard assets are still placeholders. Run `cd ../dashboard && deno task build` before `deno task build:sandbox-host`.",
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
  outfile: fileURLToPath(new URL(target.outfile, import.meta.url)),
  loader: {
    ".html": "text",
    ".css": "text",
  },
  plugins: [denoResolvePlugin()],
  logLevel: "info",
});

console.log(`Built ${targetName}: ${target.outfile}`);
