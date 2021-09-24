import {
  Log,
  MiniflareError,
  Option,
  OptionType,
  Plugin,
} from "@miniflare/shared";

const noop = () => {};

export type SchedulerErrorCode = "ERR_INVALID_CRON"; // Invalid CRON expression

export class SchedulerError extends MiniflareError<SchedulerErrorCode> {}

export interface SchedulerOptions {
  crons?: string[];
}

const kValidatedCrons = Symbol("kValidatedCrons");

export class SchedulerPlugin
  extends Plugin<SchedulerOptions>
  implements SchedulerOptions
{
  @Option({
    type: OptionType.ARRAY,
    alias: "t",
    description: "CRON expression for triggering scheduled events",
    logName: "CRON Expressions",
    fromWrangler: ({ triggers }) => triggers?.crons,
  })
  crons?: string[];

  private [kValidatedCrons]: string[];

  constructor(log: Log, options?: SchedulerOptions) {
    super(log);
    this.assignOptions(options);
  }

  get validatedCrons(): string[] {
    return this[kValidatedCrons];
  }

  async setup(): Promise<void> {
    const validatedCrons: string[] = [];
    if (!this.crons?.length) {
      this[kValidatedCrons] = validatedCrons;
      return;
    }
    const cron = await import("node-cron");
    for (const spec of this.crons) {
      try {
        // We don't use cron.validate here since that doesn't tell us why
        // parsing failed
        const task = cron.default.schedule(spec, noop, { scheduled: false });
        task.stop();
        // validateCrons is always defined here
        validatedCrons.push(spec);
      } catch (e) {
        throw new SchedulerError(
          "ERR_INVALID_CRON",
          `Unable to parse cron "${spec}": ${e}`
        );
      }
    }
    this[kValidatedCrons] = validatedCrons;
  }
}
