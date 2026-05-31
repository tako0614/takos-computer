import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [solidPlugin(), viteSingleFile()],
  build: {
    target: "esnext",
    outDir: "dist",
  },
  base: "/gui/",
});
