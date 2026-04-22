// deno-lint-ignore-file no-import-prefix
import { defineConfig } from "npm:vite@6.4.2";
import solidPlugin from "npm:vite-plugin-solid@2.11.12";
import { viteSingleFile } from "npm:vite-plugin-singlefile@2.3.2";

export default defineConfig({
  plugins: [solidPlugin(), viteSingleFile()],
  build: {
    target: "esnext",
    outDir: "dist",
  },
  base: "/gui/",
});
