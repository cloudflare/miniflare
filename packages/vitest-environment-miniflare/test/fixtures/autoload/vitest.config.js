import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    cache: false,
    environment: "miniflare",
  },
});
