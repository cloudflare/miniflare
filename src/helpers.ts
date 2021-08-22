export class MiniflareError extends Error {
  constructor(message?: string) {
    super(message);
    // Restore prototype chain:
    // https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-2.html#support-for-newtarget
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
  }
}

export function formatSize(bytes: number): string {
  if (bytes >= 524_288) return `${(bytes / 1_048_576).toFixed(2)}MiB`;
  if (bytes >= 512) return `${(bytes / 1_024).toFixed(2)}KiB`;
  return `${bytes}B`;
}
