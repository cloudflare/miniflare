import fs from "fs/promises";
import path from "path";
import { TextDecoder, TextEncoder } from "util";
import { randomHex, sanitisePath } from "@miniflare/shared";
import { ExecutionContext } from "ava";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Encode(value: string): Uint8Array {
  return encoder.encode(value);
}
export function utf8Decode(encoded?: Uint8Array): string {
  return decoder.decode(encoded);
}

const tmpRoot = path.resolve(".tmp");

export async function useTmp(t: ExecutionContext): Promise<string> {
  const filePath = path.join(tmpRoot, sanitisePath(t.title), randomHex());
  await fs.mkdir(filePath, { recursive: true });
  return filePath;
}
