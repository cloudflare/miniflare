import http from "http";
import * as colors from "kleur/colors";
import { MiniflareError } from "./helpers";

export interface Log {
  log(data: string): void;
  debug(data: string): void;
  info(data: string): void;
  warn(data: string): void;
  error(data: string): void;
}

export class NoOpLog implements Log {
  log(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(data: string): void {
    // Throw errors with NoOpLog, otherwise we'd have no way of knowing they
    // were occurring. Remove " (default..." or "(ignoring..." from error
    // message though since we're throwing instead of defaulting now.
    data = data.replace(/ \((default|ignoring).*$/, "");
    throw new MiniflareError(data);
  }
}

export class ConsoleLog implements Log {
  constructor(private logDebug = false) {}

  log(data: string): void {
    console.log(data);
  }

  debug(data: string): void {
    if (this.logDebug) console.log(colors.grey(`[mf:dbg] ${data}`));
  }

  info(data: string): void {
    console.log(colors.green(`[mf:inf] ${data}`));
  }

  warn(data: string): void {
    console.log(colors.yellow(`[mf:wrn] ${data}`));
  }

  error(data: string): void {
    console.log(colors.red(`[mf:err] ${data}`));
  }
}

export type HRTime = [seconds: number, nanoseconds: number];

function _millisFromHRTime([seconds, nanoseconds]: HRTime): string {
  return `${((seconds * 1e9 + nanoseconds) / 1e6).toFixed(2)}ms`;
}

function _colourFromHTTPStatus(status: number): colors.Colorize {
  if (200 <= status && status < 300) return colors.green;
  if (400 <= status && status < 500) return colors.yellow;
  if (500 <= status) return colors.red;
  return colors.blue;
}

export async function logResponse(
  log: Log,
  {
    start,
    method,
    url,
    status,
    waitUntil,
  }: {
    start: HRTime;
    method: string;
    url: string;
    status?: number;
    waitUntil?: Promise<any[]>;
  }
): Promise<void> {
  const responseTime = _millisFromHRTime(process.hrtime(start));

  // Wait for all waitUntil promises to resolve
  let waitUntilResponse: any[] | undefined;
  try {
    waitUntilResponse = await waitUntil;
  } catch (e) {
    log.error(e.stack);
  }
  const waitUntilTime = _millisFromHRTime(process.hrtime(start));

  log.log(
    [
      `${colors.bold(method)} ${url} `,
      status
        ? _colourFromHTTPStatus(status)(
            `${colors.bold(status)} ${http.STATUS_CODES[status]} `
          )
        : "",
      colors.grey(`(${responseTime}`),
      // Only include waitUntilTime if there were waitUntil promises
      waitUntilResponse?.length
        ? colors.grey(`, waitUntil: ${waitUntilTime}`)
        : "",
      colors.grey(")"),
    ].join("")
  );
}
