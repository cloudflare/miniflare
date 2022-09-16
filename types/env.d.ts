declare namespace NodeJS {
  export interface ProcessEnv {
    NODE_ENV?: string;
    MINIFLARE_EXEC_NAME?: string;
    MINIFLARE_SUBREQUEST_LIMIT?: string;
    MINIFLARE_INTERNAL_SUBREQUEST_LIMIT?: string;
    MINIFLARE_TEST_REDIS_URL?: string;
    NPX_IMPORT_QUIET?: string;

    // REPL options: https://nodejs.org/api/repl.html#environment-variable-options
    MINIFLARE_REPL_HISTORY?: string;
    MINIFLARE_REPL_HISTORY_SIZE?: string;
    MINIFLARE_REPL_MODE?: "sloppy" | "strict" | string;
  }
}
