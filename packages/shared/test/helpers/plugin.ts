import { parseArgv } from "@miniflare/cli";
import {
  ExtractOptions,
  PluginSignature,
  WranglerConfig,
  logOptions,
} from "@miniflare/shared";
import { TestLog } from "test:@miniflare/shared";

export function parsePluginArgv<Plugin extends PluginSignature>(
  plugin: Plugin,
  argv: string[]
): ExtractOptions<InstanceType<Plugin>> {
  return parseArgv({ plugin }, argv) as any;
}

export function parsePluginWranglerConfig<Plugin extends PluginSignature>(
  plugin: Plugin,
  config: WranglerConfig,
  configDir = ""
): ExtractOptions<InstanceType<Plugin>> {
  const result = {} as ExtractOptions<InstanceType<Plugin>>;
  for (const [key, meta] of plugin.prototype.opts?.entries() ?? []) {
    (result as any)[key] = meta.fromWrangler?.(config, configDir);
  }
  return result;
}

export function logPluginOptions<Plugin extends PluginSignature>(
  plugin: Plugin,
  options: ExtractOptions<InstanceType<Plugin>>
): string[] {
  const log = new TestLog();
  logOptions([["plugin", plugin]], log, { plugin: options });
  return log.logs
    .slice(1) // Remove "Options:" header
    .map(([, message]) => message.substring(2)); // Remove "- " prefix
}
