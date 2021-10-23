import fs from "fs/promises";
import { Log } from "@miniflare/shared";
import semiver from "semiver";
import { fetch } from "undici";

const numericCompare = new Intl.Collator(undefined, { numeric: true }).compare;

export async function updateCheck({
  pkg,
  lastCheckFile,
  log,
  now = Date.now(),
  registry = "https://registry.npmjs.org/",
}: {
  pkg: { name: string; version: string };
  lastCheckFile: string;
  log: Log;
  now?: number;
  registry?: string;
}): Promise<void> {
  // If checked within the past day, don't check again
  let lastCheck = 0;
  try {
    lastCheck = parseInt(await fs.readFile(lastCheckFile, "utf8"));
  } catch {}
  if (now - lastCheck < 86400000) return;

  // Get latest version's package.json from npm
  const res = await fetch(`${registry}${pkg.name}/latest`, {
    headers: { Accept: "application/json" },
  });
  const registryVersion: string = ((await res.json()) as any).version;
  if (!registryVersion) return;

  // Record new last check time
  await fs.writeFile(lastCheckFile, now.toString(), "utf8");

  // Log version if latest version is greater than the currently installed
  if (semiver(registryVersion, pkg.version) > 0) {
    log.warn(
      `Miniflare ${registryVersion} is available, ` +
        `but you're using ${pkg.version}. ` +
        "Update for improved compatibility with Cloudflare Workers."
    );
    const registryMajor = registryVersion.split(".")[0];
    const pkgMajor = pkg.version.split(".")[0];
    if (numericCompare(registryMajor, pkgMajor) > 0) {
      log.warn(
        `${registryVersion} includes breaking changes.` +
          "Make sure you check the changelog before upgrading."
      );
    }
  }
}
