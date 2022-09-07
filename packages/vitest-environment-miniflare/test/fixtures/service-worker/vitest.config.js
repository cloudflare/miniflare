import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    conditions: ["worker", "browser"],
  },
  test: {
    cache: false,
    environment: "miniflare",
    environmentOptions: {
      kvNamespaces: ["TEST_NAMESPACE"],
      sitePath: __dirname,
      globals: { KEY: "value" },
      // Check persistence options ignored
      kvPersist: true,
      cachePersist: true,
    },
  },
});
