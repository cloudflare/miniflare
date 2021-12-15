import { URL } from "url";
import { MiniflareError } from "@miniflare/shared";

export type RouterErrorCode = "ERR_QUERY_STRING" | "ERR_INFIX_WILDCARD";

export class RouterError extends MiniflareError<RouterErrorCode> {}

export interface Route {
  target: string;
  route: string;

  protocol?: string;
  allowHostnamePrefix: boolean;
  hostname: string;
  path: string;
  allowPathSuffix: boolean;
}

const A_MORE_SPECIFIC = -1;
const B_MORE_SPECIFIC = 1;

export class Router {
  routes: Route[] = [];

  update(allRoutes: Map<string, string[]>): void {
    const newRoutes: Route[] = [];
    for (const [target, routes] of allRoutes) {
      for (const route of routes) {
        const hasProtocol = /^[a-z0-9+\-.]+:\/\//i.test(route);

        let urlInput = route;
        // If route is missing a protocol, give it one so it parses
        if (!hasProtocol) urlInput = `https://${urlInput}`;
        const url = new URL(urlInput);

        const protocol = hasProtocol ? url.protocol : undefined;

        const allowHostnamePrefix = url.hostname.startsWith("*");
        const anyHostname = url.hostname === "*";
        if (allowHostnamePrefix && !anyHostname) {
          url.hostname = url.hostname.substring(1);
        }

        const allowPathSuffix = url.pathname.endsWith("*");
        if (allowPathSuffix) {
          url.pathname = url.pathname.substring(0, url.pathname.length - 1);
        }

        if (url.search) {
          throw new RouterError(
            "ERR_QUERY_STRING",
            `Route "${route}" for "${target}" contains a query string. This is not allowed.`
          );
        }
        if (url.toString().includes("*") && !anyHostname) {
          throw new RouterError(
            "ERR_INFIX_WILDCARD",
            `Route "${route}" for "${target}" contains an infix wildcard. This is not allowed.`
          );
        }

        newRoutes.push({
          target,
          route,

          protocol,
          allowHostnamePrefix,
          hostname: anyHostname ? "" : url.hostname,
          path: url.pathname,
          allowPathSuffix,
        });
      }
    }

    // Sort with highest specificity first
    newRoutes.sort((a, b) => {
      // 1. If one route matches on protocol, it is more specific
      const aHasProtocol = a.protocol !== undefined;
      const bHasProtocol = b.protocol !== undefined;
      if (aHasProtocol && !bHasProtocol) return A_MORE_SPECIFIC;
      if (!aHasProtocol && bHasProtocol) return B_MORE_SPECIFIC;

      // 2. If one route allows hostname prefixes, it is less specific
      if (!a.allowHostnamePrefix && b.allowHostnamePrefix)
        return A_MORE_SPECIFIC;
      if (a.allowHostnamePrefix && !b.allowHostnamePrefix)
        return B_MORE_SPECIFIC;

      // 3. If one route allows path suffixes, it is less specific
      if (!a.allowPathSuffix && b.allowPathSuffix) return A_MORE_SPECIFIC;
      if (a.allowPathSuffix && !b.allowPathSuffix) return B_MORE_SPECIFIC;

      // 4. If one route has more path segments, it is more specific
      const aPathSegments = a.path.split("/");
      const bPathSegments = b.path.split("/");

      // Specifically handle known route specificity issue here:
      // https://developers.cloudflare.com/workers/platform/known-issues#route-specificity
      const aLastSegmentEmpty = aPathSegments[aPathSegments.length - 1] === "";
      const bLastSegmentEmpty = bPathSegments[bPathSegments.length - 1] === "";
      if (aLastSegmentEmpty && !bLastSegmentEmpty) return B_MORE_SPECIFIC;
      if (!aLastSegmentEmpty && bLastSegmentEmpty) return A_MORE_SPECIFIC;

      if (aPathSegments.length !== bPathSegments.length)
        return bPathSegments.length - aPathSegments.length;

      // 5. If one route has a longer path, it is more specific
      if (a.path.length !== b.path.length) return b.path.length - a.path.length;

      // 6. Finally, if one route has a longer hostname, it is more specific
      return b.hostname.length - a.hostname.length;
    });

    this.routes = newRoutes;
  }

  match(url: URL): string | null {
    for (const route of this.routes) {
      if (route.protocol && route.protocol !== url.protocol) continue;

      if (route.allowHostnamePrefix) {
        if (!url.hostname.endsWith(route.hostname)) continue;
      } else {
        if (url.hostname !== route.hostname) continue;
      }

      const path = url.pathname + url.search;
      if (route.allowPathSuffix) {
        if (!path.startsWith(route.path)) continue;
      } else {
        if (path !== route.path) continue;
      }

      return route.target;
    }

    return null;
  }
}
