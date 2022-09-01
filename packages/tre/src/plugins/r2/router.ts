import { Response } from "undici";
import { TextDecoder, TextEncoder } from "util";
import {
  DELETE,
  GET,
  PUT,
  RouteHandler,
  Router,
  decodePersist,
} from "../shared";
import { R2Gateway } from "./gateway";

export interface R2Params {
  bucket: string;
  key: string;
}
export class R2Router extends Router<R2Gateway> {
  @GET("/:bucket/:key")
  get: RouteHandler<R2Params> = async (req, params) => {
    console.log("GET KEY");

    const persist = decodePersist(req.headers);
    const gateway = this.gatewayFactory.get(params.bucket, persist);
    await gateway.get(params.key);
    return new Response();
  };

  @PUT("/:bucket")
  put: RouteHandler<Omit<R2Params, "key">> = async (req, params) => {
    const bytes = await req.arrayBuffer();

    const metadataSize = Number(req.headers.get("cf-r2-metadata-size"));

    const [metadataBytes, value] = [
      bytes.slice(0, metadataSize),
      bytes.slice(metadataSize),
    ];
    const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
    const persist = decodePersist(req.headers);
    const gateway = this.gatewayFactory.get(params.bucket, persist);
    return Response.json(
      await gateway.put(metadata.object, new Uint8Array(value))
    );
  };

  @DELETE("/:bucket/:key")
  delete: RouteHandler<R2Params> = async (req, params) => {
    const persist = decodePersist(req.headers);
    const gateway = this.gatewayFactory.get(params.bucket, persist);
    await gateway.delete(params.key);
    return new Response();
  };

  @GET("/:bucket/")
  list: RouteHandler<Omit<R2Params, "key">> = async (req, params) => {
    const persist = decodePersist(req.headers);
    const gateway = this.gatewayFactory.get(params.bucket, persist);

    const json = JSON.stringify(await gateway.list());
    const utf8 = new TextEncoder().encode(json);
    const byteSize = utf8.length;

    return new Response(json, {
      headers: {
        "CF-R2-Metadata-Size": `${byteSize}`,
        "Content-Type": "application/json",
      },
    });
  };
}
