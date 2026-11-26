import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    fileParallelism: false,
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          pool: "vmThreads",
          isolate: false,
          include: ["src/server/**/*.test.ts"],
          coverage: {
            provider: "v8",
            include: ["src/server/**"],
          },
        },
      },
      {
        extends: true,
        test: {
          name: "client",
          environment: "jsdom",
          include: ["src/components/**/*.test.tsx", "src/lib/**/*.test.ts"],
          coverage: {
            provider: "v8",
            include: ["src/lib/**", "src/components/**"],
          },
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
