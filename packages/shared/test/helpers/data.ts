import { promises as fs } from "fs";
import path from "path";
import { sanitisePath } from "@miniflare/shared";
import { ExecutionContext } from "ava";
import rimraf from "rimraf";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Encode(value: string): Uint8Array {
  return encoder.encode(value);
}
export function utf8Decode(encoded?: Uint8Array): string {
  return decoder.decode(encoded);
}

const tmpRoot = path.resolve(".tmp");

export function randomHex(digits = 8): string {
  return Array.from(Array(digits))
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("");
}

export async function useTmp(t: ExecutionContext): Promise<string> {
  const filePath = path.join(tmpRoot, sanitisePath(t.title), randomHex());
  await fs.mkdir(filePath, { recursive: true });
  t.teardown(() => rimraf.sync(filePath));
  return filePath;
}
