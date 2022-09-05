import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    cache: false,
    environment: "miniflare",
    environmentOptions: {
      modules: true,
      scriptPath: path.join(__dirname, "module-worker.js"),
      durableObjects: { TEST_OBJECT: "TestObject" },
      // Check persistence options ignored
      durableObjectsPersist: true,
    },
  },
});
