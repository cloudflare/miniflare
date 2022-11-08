import { Request, RequestInit, Response } from "undici";
import {
  DELETE,
  GET,
  PUT,
  RouteHandler,
  Router,
  decodePersist,
  PURGE,
  CfHeader,
} from "../shared";
import { CacheError, fallible } from "./errors";
import { CacheGateway } from "./gateway";

export interface CacheParams {
  namespace: string;
  uri: string;
}

export class CacheRouter extends Router<CacheGateway> {
  @GET("/:uri")
  match: RouteHandler<CacheParams> = async (req, params) => {
    const uri = decodeURIComponent(params.uri);
    const persist = decodePersist(req.headers);
    const ns = req.headers.get(CfHeader.CacheNamespace);
    console.log(req.headers);
    const gateway = this.gatewayFactory.get(
      params.namespace + ns ? `:ns:${ns}` : `:default`,
      persist
    );
    return fallible(gateway.match(new Request(uri, req as RequestInit)));
  };

  @PUT("/:uri")
  put: RouteHandler<CacheParams> = async (req, params) => {
    const uri = decodeURIComponent(params.uri);
    const persist = decodePersist(req.headers);
    const ns = req.headers.get(CfHeader.CacheNamespace);
    const gateway = this.gatewayFactory.get(
      params.namespace + ns ? `:ns:${ns}` : `:default`,
      persist
    );
    return fallible(
      gateway.put(new Request(uri, req as RequestInit), await req.arrayBuffer())
    );
  };

  @PURGE("/:uri")
  delete: RouteHandler<CacheParams> = async (req, params) => {
    const uri = decodeURIComponent(params.uri);
    const persist = decodePersist(req.headers);
    const ns = req.headers.get(CfHeader.CacheNamespace);
    const gateway = this.gatewayFactory.get(
      params.namespace + ns ? `:ns:${ns}` : `:default`,
      persist
    );
    return fallible(gateway.delete(new Request(uri, req as RequestInit)));
  };
}
