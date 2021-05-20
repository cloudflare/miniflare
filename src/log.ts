import http from "http";
import chalk from "chalk";

export interface Log {
  log(data: string): void;
  debug(data: string): void;
  info(data: string): void;
  warn(data: string): void;
  error(data: string): void;
}

export class NoOpLog implements Log {
  debug(): void {}
  error(): void {}
  info(): void {}
  log(): void {}
  warn(): void {}
}

export class ConsoleLog implements Log {
  constructor(private logDebug = false) {}

  log(data: string): void {
    console.log(data);
  }

  debug(data: string): void {
    if (this.logDebug) console.debug(chalk.grey(`[mf:debug] ${data}`));
  }

  info(data: string): void {
    console.debug(chalk.green(`[mf:info] ${data}`));
  }

  warn(data: string): void {
    console.debug(chalk.yellow(`[mf:warn] ${data}`));
  }

  error(data: string): void {
    console.debug(chalk.red(`[mf:error] ${data}`));
  }
}

export type HRTime = [seconds: number, nanoseconds: number];

function _millisFromHRTime([seconds, nanoseconds]: HRTime): string {
  return `${((seconds * 1e9 + nanoseconds) / 1e6).toFixed(2)}ms`;
}

function _colourFromHTTPStatus(status: number): chalk.ChalkFunction {
  if (200 <= status && status < 300) return chalk.green;
  if (400 <= status && status < 500) return chalk.yellow;
  if (500 <= status) return chalk.red;
  return chalk.blue;
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
    method?: string;
    url?: string;
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
      `${chalk.bold(method)} ${url} `,
      status
        ? _colourFromHTTPStatus(status)(
            `${chalk.bold(status)} ${http.STATUS_CODES[status]} `
          )
        : "",
      chalk.grey(`(${responseTime}`),
      // Only include waitUntilTime if there were waitUntil promises
      waitUntilResponse?.length
        ? chalk.grey(`, waitUntil: ${waitUntilTime}`)
        : "",
      chalk.grey(")"),
    ].join("")
  );
}
