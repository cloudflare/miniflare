import { networkInterfaces } from "os";

export function getAccessibleHosts(ipv4 = false): string[] {
  const hosts: string[] = [];
  Object.values(networkInterfaces()).forEach((net) =>
    net?.forEach(({ family, address }) => {
      if (!ipv4 || family === "IPv4") hosts.push(address);
    })
  );
  return hosts;
}
