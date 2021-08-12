const { promises: fs } = require("fs");
const path = require("path");

(async () => {
  const changelogPath = path.resolve(__dirname, "..", "..", "CHANGELOG.md");
  const changelog = await fs.readFile(changelogPath, "utf8");

  const docsChangelogPath = path.resolve(__dirname, "..", "changelog.md");
  // Rewrite https://miniflare.dev paths to relative paths
  const docsChangelog = changelog.replace(/]\(https:\/\/miniflare.dev/g, "](");
  await fs.writeFile(docsChangelogPath, docsChangelog, "utf8");
})();
