import path from "path";

export function pathsToString(set: Iterable<string>): string {
  return [...set]
    .map((filePath) => path.relative("", filePath))
    .sort()
    .join(", ");
}

export function formatSize(bytes: number): string {
  if (bytes >= 524_288) return `${(bytes / 1_048_576).toFixed(2)}MiB`;
  if (bytes >= 512) return `${(bytes / 1_024).toFixed(2)}KiB`;
  return `${bytes}B`;
}

export function addAll<T>(set: Set<T>, values: Iterable<T>): void {
  for (const value of values) set.add(value);
}
