/* eslint-disable */
export default {
  "files": [
    "packages/*/test/**/*.spec.ts"
  ],
  "timeout": "5m",
  "nodeArguments": [
    "--experimental-vm-modules"
  ],
  "typescript": {
    "compile": false,
    "rewritePaths": {
      "packages/cache/test/": "packages/cache/dist/test/",
      "packages/cli/test/": "packages/cli/dist/test/",
      "packages/core/test/": "packages/core/dist/test/",
      "packages/durable-objects/test/": "packages/durable-objects/dist/test/",
      "packages/html-rewriter/test/": "packages/html-rewriter/dist/test/",
      "packages/http-server/test/": "packages/http-server/dist/test/",
      "packages/jest/test/": "packages/jest/dist/test/",
      "packages/kv/test/": "packages/kv/dist/test/",
      "packages/miniflare/test/": "packages/miniflare/dist/test/",
      "packages/runner-vm/test/": "packages/runner-vm/dist/test/",
      "packages/scheduler/test/": "packages/scheduler/dist/test/",
      "packages/shared/test/": "packages/shared/dist/test/",
      "packages/sites/test/": "packages/sites/dist/test/",
      "packages/storage-file/test/": "packages/storage-file/dist/test/",
      "packages/storage-memory/test/": "packages/storage-memory/dist/test/",
      "packages/storage-redis/test/": "packages/storage-redis/dist/test/",
      "packages/watcher/test/": "packages/watcher/dist/test/",
      "packages/web-sockets/test/": "packages/web-sockets/dist/test/"
    }
  }
};