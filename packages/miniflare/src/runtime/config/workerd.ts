// TODO: auto-generate this file
import type {
  HttpOptions_Style,
  TlsOptions_Version,
  Worker_Binding_CryptoKey_Usage,
} from "./workerd.capnp.js";

export {
  HttpOptions_Style,
  TlsOptions_Version,
  Worker_Binding_CryptoKey_Usage,
} from "./workerd.capnp.js";

export const kVoid = Symbol("kVoid");
export type Void = typeof kVoid;

export interface Config {
  services?: Service[];
  sockets?: Socket[];
  v8Flags?: string[];
  extensions?: Extension[];
}

export type Socket = {
  name?: string;
  address?: string;
  service?: ServiceDesignator;
} & ({ http?: HttpOptions } | { https?: Socket_Https });

export interface Socket_Https {
  options?: HttpOptions;
  tlsOptions?: TlsOptions;
}

export type Service = {
  name?: string;
} & (
  | { worker?: Worker }
  | { network?: Network }
  | { external?: ExternalServer }
  | { disk?: DiskDirectory }
);

export interface ServiceDesignator {
  name?: string;
  entrypoint?: string;
}

export type Worker = (
  | { modules?: Worker_Module[] }
  | { serviceWorkerScript?: string }
  | { inherit?: string }
) & {
  compatibilityDate?: string;
  compatibilityFlags?: string[];
  bindings?: Worker_Binding[];
  globalOutbound?: ServiceDesignator;
  cacheApiOutbound?: ServiceDesignator;
  durableObjectNamespaces?: Worker_DurableObjectNamespace[];
  durableObjectUniqueKeyModifier?: string;
  durableObjectStorage?: Worker_DurableObjectStorage;
};

export type Worker_DurableObjectStorage =
  | { none?: Void }
  | { inMemory?: Void }
  | { localDisk?: string };

export type Worker_Module = {
  name: string;
} & (
  | { esModule?: string }
  | { commonJsModule?: string }
  | { text?: string }
  | { data?: Uint8Array }
  | { wasm?: Uint8Array }
  | { json?: string }
  | { nodeJsCompatModule?: string }
);

export type Worker_Binding = {
  name?: string;
} & (
  | { parameter?: Worker_Binding_Parameter }
  | { text?: string }
  | { data?: Uint8Array }
  | { json?: string }
  | { wasmModule?: Uint8Array }
  | { cryptoKey?: Worker_Binding_CryptoKey }
  | { service?: ServiceDesignator }
  | { durableObjectNamespace?: Worker_Binding_DurableObjectNamespaceDesignator }
  | { kvNamespace?: ServiceDesignator }
  | { r2Bucket?: ServiceDesignator }
  | { r2Admin?: ServiceDesignator }
  | { wrapped?: Worker_Binding_WrappedBinding }
  | { queue?: ServiceDesignator }
  | { fromEnvironment?: string }
  | { analyticsEngine?: ServiceDesignator }
  | { hyperdrive?: Worker_Binding_Hyperdrive }
);

export interface Worker_Binding_Parameter {
  type?: Worker_Binding_Type;
  optional?: boolean;
}

export type Worker_Binding_Type =
  | { text?: Void }
  | { data?: Void }
  | { json?: Void }
  | { wasm?: Void }
  | { cryptoKey?: Worker_Binding_CryptoKey_Usage[] }
  | { service?: Void }
  | { durableObjectNamespace: Void }
  | { kvNamespace?: Void }
  | { r2Bucket?: Void }
  | { r2Admin?: Void }
  | { queue?: Void }
  | { analyticsEngine?: Void }
  | { hyperdrive?: Void };

export type Worker_Binding_DurableObjectNamespaceDesignator = {
  className?: string;
  serviceName?: string;
};

export type Worker_Binding_CryptoKey = (
  | { raw?: Uint8Array }
  | { hex?: string }
  | { base64?: string }
  | { pkcs8?: string }
  | { spki?: string }
  | { jwk?: string }
) & {
  algorithm?: Worker_Binding_CryptoKey_Algorithm;
  extractable?: boolean;
  usages?: Worker_Binding_CryptoKey_Usage[];
};

export interface Worker_Binding_WrappedBinding {
  moduleName?: string;
  entrypoint?: string;
  innerBindings?: Worker_Binding[];
}

export type Worker_Binding_CryptoKey_Algorithm =
  | { name?: string }
  | { json?: string };

export interface Worker_Binding_Hyperdrive {
  designator?: ServiceDesignator;
  database?: string;
  user?: string;
  password?: string;
  scheme?: string;
}

export type Worker_DurableObjectNamespace = {
  className?: string;
  preventEviction?: boolean;
} & ({ uniqueKey?: string } | { ephemeralLocal?: Void });

export type ExternalServer = { address?: string } & (
  | { http: HttpOptions }
  | { https: ExternalServer_Https }
  | { tcp: ExternalServer_Tcp }
);

export interface ExternalServer_Https {
  options?: HttpOptions;
  tlsOptions?: TlsOptions;
  certificateHost?: string;
}

export interface ExternalServer_Tcp {
  tlsOptions?: TlsOptions;
  certificateHost?: string;
}

export interface Network {
  allow?: string[];
  deny?: string[];
  tlsOptions?: TlsOptions;
}

export interface DiskDirectory {
  path?: string;
  writable?: boolean;
}

export interface HttpOptions {
  style?: HttpOptions_Style;
  forwardedProtoHeader?: string;
  cfBlobHeader?: string;
  injectRequestHeaders?: HttpOptions_Header[];
  injectResponseHeaders?: HttpOptions_Header[];
}

export interface HttpOptions_Header {
  name?: string;
  value?: string;
}

export interface TlsOptions {
  keypair?: TlsOptions_Keypair;
  requireClientCerts?: boolean;
  trustBrowserCas?: boolean;
  trustedCertificates?: string[];
  minVersion?: TlsOptions_Version;
  cipherList?: string;
}

export interface TlsOptions_Keypair {
  privateKey?: string;
  certificateChain?: string;
}

export interface Extension {
  modules?: Extension_Module[];
}

export interface Extension_Module {
  name?: string;
  internal?: boolean;
  esModule?: string;
}
