const { Module } = require("module");
const path = require("path");

// Logs "require" times of loaded modules, run with
// node -r ./scripts/perf.js ./packages/miniflare/dist/src/cli.js
// NOTE: this script will need to be updated to work with ESM

const _load = Module._load;

const stack = [];
let logs = [];

let logTimeout;

const seen = new Set();

function dumpLogs() {
  for (const log of logs) {
    if (log.stackLength > 4) continue;

    const padding = "".padStart(log.stackLength * 2, " ");

    let resolved = require.resolve(
      log.request,
      log.parent ? { paths: [log.parent.path, ...log.parent.paths] } : undefined
    );
    resolved = path.isAbsolute(resolved)
      ? path.relative("", resolved)
      : resolved;

    if (seen.has(resolved)) {
      // console.log(`\x1b[90m${padding}${resolved}\x1b[39m`);
    } else {
      const time = `${Number(log.time) / 1_000_000}ms`;
      console.log(`${padding}${resolved} \x1b[33m${time}\x1b[39m`);
    }

    seen.add(resolved);
  }
  logs = [];
}

Module._load = function (request, parent, isMain) {
  clearTimeout(logTimeout);
  logTimeout = setTimeout(dumpLogs, 1000);

  const log = {
    stackLength: stack.length,
    request,
    parent,
    time: undefined,
  };
  logs.push(log);

  stack.push(request);
  const start = process.hrtime.bigint();
  const result = _load(request, parent, isMain);
  log.time = process.hrtime.bigint() - start;
  stack.pop();

  return result;
};
