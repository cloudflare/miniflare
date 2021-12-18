import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const changelogPath = path.resolve(__dirname, "..", "CHANGELOG.md");

const docsChangelogPath = path.resolve(
  __dirname,
  "src",
  "content",
  "get-started",
  "changelog.md"
);

export async function copyChangelog() {
  const changelog = await fs.readFile(changelogPath, "utf8");

  // Rewrite absolute https://miniflare.dev paths to relative ones
  const docsChangelog =
    `---\norder: 2\n---\n\n` +
    changelog.replace(/]\(https:\/\/(v\d+\.)?miniflare.dev/g, "](");

  await fs.writeFile(docsChangelogPath, docsChangelog, "utf8");
}

void copyChangelog();
