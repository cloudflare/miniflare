import { promises as fs } from "fs";
import path from "path";
import chokidar from "chokidar";
import { changelogPath, copyChangelog } from "./changelog.mjs";

async function copyFile(srcPath) {
  console.log("Updated", srcPath);
  if (srcPath === changelogPath) return copyChangelog();
  const targetPath = path.join(".docs", srcPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(srcPath, targetPath);
}

chokidar
  .watch(["src", "docs-config.js", changelogPath], {
    persistent: true,
    ignoreInitial: true,
  })
  .on("add", copyFile)
  .on("change", copyFile);
