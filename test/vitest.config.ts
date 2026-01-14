import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    threads: false,
    root: path.resolve(__dirname),
  },
  resolve: {
    alias: {
      "#compiler": path.resolve(__dirname, "../packages/bugc/src/compiler"),
      "#result": path.resolve(__dirname, "../packages/bugc/src/result.ts"),
    },
  },
});
