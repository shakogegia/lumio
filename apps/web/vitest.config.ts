import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      DATABASE_URL: "postgresql://lumio:lumio@localhost:5433/lumio?schema=public",
    },
  },
});
