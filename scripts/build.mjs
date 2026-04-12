import { build } from "esbuild";

await build({
  entryPoints: ["src/extension/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: false,
  target: "node22"
});
