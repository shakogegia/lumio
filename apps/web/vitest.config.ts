import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    env: {
      DATABASE_URL: "postgresql://lumio:lumio@localhost:5433/lumio?schema=public",
    },
  },
});
