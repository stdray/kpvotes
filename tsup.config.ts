import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/bootstrap.ts"],
  format: "esm",
  target: "node22",
  outDir: "dist",
  clean: true,
  shims: false,
  dts: false,
  // Все node_modules — external, кроме @lightpanda/browser (он запускает бинарник)
  external: [/^[^./]/],
});
