import { networkInterfaces } from "os";

export function getAccessibleHosts(ipv4 = false): string[] {
  const hosts: string[] = [];
  Object.values(networkInterfaces()).forEach((net) => {
    net?.forEach(({ family, address }) => {
      // The `family` property being numeric was reverted in Node 18.2
      // https://github.com/nodejs/node/issues/43014
      // @ts-expect-error the `family` property is numeric as of Node.js 18.0.0
      if (!ipv4 || family === "IPv4" || family === 4) hosts.push(address);
    });
  });
  return hosts;
}
