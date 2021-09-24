import { promises as fs } from "fs";
import path from "path";

function onNotFound<T, V>(promise: Promise<T>, value: V): Promise<T | V> {
  return promise.catch((e) => {
    if (e.code === "ENOENT") return value;
    throw e;
  });
}

export function readFile(filePath: string): Promise<Buffer | undefined>;
export function readFile(
  filePath: string,
  decode: true
): Promise<string | undefined>;
export function readFile(
  filePath: string,
  decode?: true
): Promise<Buffer | string | undefined> {
  return onNotFound(fs.readFile(filePath, decode && "utf8"), undefined);
}

export async function writeFile(
  filePath: string,
  data: Uint8Array | string
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    data,
    typeof data === "string" ? "utf8" : undefined
  );
}

export function deleteFile(filePath: string): Promise<boolean> {
  return onNotFound(
    fs.unlink(filePath).then(() => true),
    false
  );
}

export function readDir(filePath: string): Promise<string[]> {
  return onNotFound(fs.readdir(filePath), []);
}

export async function* walk(rootPath: string): AsyncGenerator<string> {
  const fileNames = await readDir(rootPath);
  for (const fileName of fileNames) {
    const filePath = path.join(rootPath, fileName);
    if ((await fs.stat(filePath)).isDirectory()) {
      yield* walk(filePath);
    } else {
      yield filePath;
    }
  }
}
