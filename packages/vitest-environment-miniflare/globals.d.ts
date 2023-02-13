import "@miniflare/shared-test-environment/globals";
import { describe } from "vitest";

declare global {
  /**
   * Automatically undo changes made in tests. Make sure to use the returned
   * `describe` function instead of the one from the `vitest` module.
   * See https://miniflare.dev/testing/vitest#isolated-storage for more details.
   */
  function setupMiniflareIsolatedStorage(): typeof describe;
}
