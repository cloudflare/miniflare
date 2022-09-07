import {
  CorePluginSignatures,
  MiniflareCore,
  ReloadEvent,
  logResponse,
} from "@miniflare/core";
import type { Cron, ITimerHandle } from "cron-schedule";
import { SchedulerPlugin } from "./plugin";

export * from "./plugin";

export interface CronSchedulerImpl {
  setInterval(cron: Cron, task: () => any): ITimerHandle;
  clearTimeoutOrInterval(handle: ITimerHandle): void;
}

export type SchedulerPluginSignatures = CorePluginSignatures & {
  SchedulerPlugin: typeof SchedulerPlugin;
};

const kReload = Symbol("kReload");

export class CronScheduler<Plugins extends SchedulerPluginSignatures> {
  // noinspection JSMismatchedCollectionQueryUpdate
  private previousValidatedCrons?: Cron[];
  private scheduledHandles?: ITimerHandle[];
  private inaccurateCpu?: boolean;

  constructor(
    private readonly mf: MiniflareCore<Plugins>,
    private readonly cronScheduler: Promise<CronSchedulerImpl> = Promise.resolve().then(
      () => require("cron-schedule").TimerBasedCronScheduler
    )
  ) {
    mf.addEventListener("reload", this[kReload]);
  }

  [kReload] = async (event: ReloadEvent<Plugins>): Promise<void> => {
    const validatedCrons = event.plugins.SchedulerPlugin.validatedCrons;
    this.inaccurateCpu = event.plugins.CorePlugin.inaccurateCpu;
    // Checking references here, if different, SchedulerPlugin setup must've
    // been called meaning crons changed so reload scheduled tasks
    if (this.previousValidatedCrons === validatedCrons) return;
    this.previousValidatedCrons = validatedCrons;

    const cronScheduler = await this.cronScheduler;

    // Schedule tasks, stopping all current ones first
    this.scheduledHandles?.forEach((handle) =>
      cronScheduler.clearTimeoutOrInterval(handle)
    );
    if (!validatedCrons.length) return;

    this.scheduledHandles = validatedCrons?.map((cron) => {
      const spec = cron.toString();
      return cronScheduler.setInterval(cron, async () => {
        const start = process.hrtime();
        const startCpu = this.inaccurateCpu ? process.cpuUsage() : undefined;
        // scheduledTime will default to Date.now()
        const waitUntil = this.mf.dispatchScheduled(undefined, spec);
        await logResponse(this.mf.log, {
          start,
          startCpu,
          method: "SCHD",
          url: spec,
          waitUntil,
        });
      });
    });
  };

  async dispose(): Promise<void> {
    this.mf.removeEventListener("reload", this[kReload]);
    const cronScheduler = await this.cronScheduler;
    this.scheduledHandles?.forEach((handle) =>
      cronScheduler.clearTimeoutOrInterval(handle)
    );
  }
}

export async function startScheduler<Plugins extends SchedulerPluginSignatures>(
  mf: MiniflareCore<Plugins>,
  cronScheduler?: Promise<CronSchedulerImpl>
): Promise<CronScheduler<Plugins>> {
  const scheduler = new CronScheduler(mf, cronScheduler);
  const reloadEvent = new ReloadEvent("reload", {
    plugins: await mf.getPlugins(),
    initial: false,
  });
  await scheduler[kReload](reloadEvent);
  return scheduler;
}
