import fs from "fs/promises";
import path from "path";

export interface FileRange {
  value: Buffer;
  offset: number;
  length: number;
}

async function onNotFound<T, V>(promise: Promise<T>, value: V): Promise<T | V> {
  try {
    return await promise;
  } catch (e: any) {
    if (e.code === "ENOENT") return value;
    throw e;
  }
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

export async function readFileRange(
  filePath: string,
  offset?: number,
  length?: number,
  suffix?: number
): Promise<FileRange | undefined> {
  let fd: fs.FileHandle | null = null;
  let res: Buffer;
  try {
    const { size } = await fs.lstat(filePath);
    // build offset and length as necessary
    if (suffix !== undefined) {
      if (suffix <= 0) {
        throw new Error("Suffix must be > 0");
      }
      offset = size - suffix;
      length = size - offset;
    }
    if (offset === undefined) offset = 0;
    if (length === undefined) {
      // get length of file
      length = size - offset;
    }

    // check offset and length are valid
    if (offset < 0) throw new Error("Offset must be >= 0");
    if (offset >= size) throw new Error("Offset must be < size");
    if (length <= 0) throw new Error("Length must be > 0");
    if (offset + length > size) length = size - offset;

    // read file
    fd = await fs.open(filePath, "r");
    res = Buffer.alloc(length);
    await fd.read(res, 0, length, offset);
  } catch (e: any) {
    if (e.code === "ENOENT") return undefined;
    throw e;
  } finally {
    await fd?.close();
  }
  return { value: res, offset, length };
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
