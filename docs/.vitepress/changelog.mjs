import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const changelogPath = path.resolve(__dirname, "..", "..", "CHANGELOG.md");
const changelog = await fs.readFile(changelogPath, "utf8");

const docsChangelogPath = path.resolve(__dirname, "..", "changelog.md");
// Rewrite https://miniflare.dev paths to relative paths
const docsChangelog = changelog.replace(
  /]\(https:\/\/(v\d+\.)?miniflare.dev/g,
  "]("
);
await fs.writeFile(docsChangelogPath, docsChangelog, "utf8");
