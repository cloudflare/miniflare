declare namespace NodeJS {
  export interface ProcessEnv {
    NODE_ENV?: string;
    NODE_EXTRA_CA_CERTS?: string;
    MINIFLARE_ASSERT_BODIES_CONSUMED?: string;
    MINIFLARE_DURABLE_OBJECT_SIMULATORS?: string;
  }
}
