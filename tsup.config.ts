import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", manifest: "src/types/manifest.ts", constants: "src/constants.ts", signature: "src/signature.ts", octokit: "src/octokit.ts" },
  format: ["cjs", "esm"],
  outDir: "dist",
  splitting: false,
  sourcemap: false,
  clean: true,
  dts: true,
  legacyOutput: false,
});
