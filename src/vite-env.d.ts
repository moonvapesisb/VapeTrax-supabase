/// <reference types="vite/client" />

export {};

declare global {
  /** Short git SHA of this build, injected by the `define` in vite.config.ts. */
  const __APP_BUILD__: string;
}
