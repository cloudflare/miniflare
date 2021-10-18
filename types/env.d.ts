declare namespace NodeJS {
  export interface ProcessEnv {
    NODE_ENV?: string;
    MINIFLARE_EXEC_NAME?: string;
    MINIFLARE_TEST_REDIS_URL?: string;
  }
}
